import Foundation
import Vision
import ImageIO
import CoreGraphics
import CoreML

// All public rectangles use normalized coordinates from the oriented image's top left.
struct Region: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    var valid: Bool {
        [x, y, width, height].allSatisfy { $0.isFinite } && x >= 0 && y >= 0 &&
        width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001
    }
}
struct RegionPair: Decodable { let left: Region?; let right: Region? }
struct Input: Decodable {
    let leftPath: String
    let rightPath: String
    let regions: [String: RegionPair]?
    let allowAutomatic: Bool?
    let categories: [String]?
}
struct Check: Encodable {
    let category: String
    let status: String
    let distance: Double?
    let colorDelta: Double?
    let threshold: Double?
    let similarThreshold: Double?
    let regions: [String: Region]?
    let origin: String
    let message: String
}
struct Output: Encodable {
    let version: Int
    let engine: String
    let featureRevision: Int
    let faces: [String: [Region]]
    let imageSizes: [String: [String: Int]]
    let checks: [Check]
    let elapsedMs: Double
    let limitations: [String]
}
struct WorkerError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
struct Face {
    let region: Region
    let confidence: Float
}

func loadImage(_ path: String) throws -> CGImage {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        throw WorkerError(message: "No se pudo abrir el fotograma: \(url.lastPathComponent).")
    }
    // ImageIO applies EXIF orientation before coordinates are calculated, and never writes the input.
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 1536,
        kCGImageSourceShouldCacheImmediately: true]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
        throw WorkerError(message: "No se pudo decodificar el fotograma.")
    }
    return image
}

func onlyCPU(_ request: VNRequest) throws {
    // Keep every supported compute stage on CPU, including the feature-print backbone.
    request.usesCPUOnly = true
    if #available(macOS 14.0, *) {
        let devices = try request.supportedComputeStageDevices
        for (stage, candidates) in devices {
            guard let cpu = candidates.first(where: { device in
                if case .cpu = device { return true }
                return false
            }) else {
                throw WorkerError(message: "Apple Vision no ofrece CPU para esta operación.")
            }
            request.setComputeDevice(cpu, for: stage)
        }
    }
    request.preferBackgroundProcessing = true
}

func faces(_ image: CGImage) throws -> [Face] {
    let request = VNDetectFaceRectanglesRequest()
    request.revision = VNDetectFaceRectanglesRequestRevision3
    try onlyCPU(request)
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    return (request.results ?? []).map { face in
        let box = face.boundingBox
        return Face(region: Region(x: Double(box.minX), y: Double(1 - box.maxY),
                                  width: Double(box.width), height: Double(box.height)),
                    confidence: face.confidence)
    }.sorted { $0.region.x < $1.region.x }
}

func crop(_ image: CGImage, _ region: Region) throws -> CGImage {
    guard region.valid else { throw WorkerError(message: "La zona marcada está fuera del fotograma.") }
    let rectangle = CGRect(x: region.x * Double(image.width), y: region.y * Double(image.height),
                           width: region.width * Double(image.width), height: region.height * Double(image.height)).integral
    guard rectangle.width >= 40, rectangle.height >= 40,
          let cropped = image.cropping(to: rectangle) else {
        throw WorkerError(message: "La zona tiene menos de 40 píxeles útiles; selecciona un fotograma más cercano.")
    }
    return cropped
}

func feature(_ image: CGImage) throws -> VNFeaturePrintObservation {
    let request = VNGenerateImageFeaturePrintRequest()
    // Revision 2 uses normalized feature prints; thresholds are specific to this revision.
    request.revision = VNGenerateImageFeaturePrintRequestRevision2
    request.imageCropAndScaleOption = .scaleFit
    try onlyCPU(request)
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    guard let result = request.results?.first else { throw WorkerError(message: "Apple Vision no obtuvo detalle suficiente.") }
    return result
}

func colorStatistics(_ image: CGImage) throws -> (mean: [Double], variance: Double) {
    let side = 32
    var pixels = [UInt8](repeating: 0, count: side * side * 4)
    let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8,
                                      bytesPerRow: side * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        return true
    }
    guard rendered else { throw WorkerError(message: "No se pudo medir el color de la zona.") }
    var mean = [Double](repeating: 0, count: 3)
    let count = Double(side * side)
    for pixel in stride(from: 0, to: pixels.count, by: 4) {
        for channel in 0..<3 { mean[channel] += Double(pixels[pixel + channel]) / (255 * count) }
    }
    var variance = 0.0
    for pixel in stride(from: 0, to: pixels.count, by: 4) {
        for channel in 0..<3 { variance += pow(Double(pixels[pixel + channel]) / 255 - mean[channel], 2) / (3 * count) }
    }
    return (mean, variance)
}

func automaticRegion(_ category: String, _ found: [Face]) -> Region? {
    guard found.count == 1, let face = found.first, face.confidence >= 0.8 else { return nil }
    if category == "face" { return face.region }
    guard category == "wardrobe" else { return nil }
    // This is a suggested torso area, not clothing segmentation; clipped torsos need a manual region.
    let width = face.region.width * 2.1
    let height = face.region.height * 2.4
    let x = face.region.x + (face.region.width - width) / 2
    let y = face.region.y + face.region.height * 1.05
    let left = max(0, x), top = max(0, y)
    let right = min(1, x + width), bottom = min(1, y + height)
    guard right > left, bottom > top, (right - left) * (bottom - top) >= width * height * 0.75 else { return nil }
    return Region(x: left, y: top, width: right - left, height: bottom - top)
}

func compare(_ category: String, _ input: Input, _ left: CGImage, _ right: CGImage,
             _ leftFaces: [Face], _ rightFaces: [Face]) -> Check {
    let pair = input.regions?[category]
    let hasManual = pair?.left != nil || pair?.right != nil
    let origin = hasManual ? "manual" : "single-face"
    func insufficient(_ message: String, regions: [String: Region]? = nil, distance: Double? = nil,
                      color: Double? = nil, threshold: Double? = nil, similar: Double? = nil) -> Check {
        Check(category: category, status: "insufficient", distance: distance, colorDelta: color,
              threshold: threshold, similarThreshold: similar, regions: regions,
              origin: regions == nil ? "unavailable" : origin, message: message)
    }
    if let region = pair?.left, !region.valid { return insufficient("La zona izquierda no es válida. Márcala de nuevo.") }
    if let region = pair?.right, !region.valid { return insufficient("La zona derecha no es válida. Márcala de nuevo.") }
    if hasManual && (pair?.left == nil || pair?.right == nil) {
        let missing = pair?.left == nil ? "izquierdo" : "derecho"
        return insufficient("Marca también la zona en el plano \(missing). Una comparación manual necesita zonas en ambos planos.")
    }
    let allowAuto = input.allowAutomatic != false
    let leftRegion = pair?.left ?? (allowAuto ? automaticRegion(category, leftFaces) : nil)
    let rightRegion = pair?.right ?? (allowAuto ? automaticRegion(category, rightFaces) : nil)
    guard let leftRegion, let rightRegion else {
        if category == "object" { return insufficient("Marca el mismo objeto en ambos planos. No se identifican objetos automáticamente.") }
        if !allowAuto { return insufficient("Para este elemento, marca las zonas que quieres comparar en ambos planos.") }
        if leftFaces.count > 1 || rightFaces.count > 1 { return insufficient("Hay varios rostros. Marca el rostro del personaje y su vestuario en ambos planos.") }
        if leftFaces.isEmpty || rightFaces.isEmpty { return insufficient("No se ve un único rostro con suficiente claridad en ambos planos. Marca las zonas o elige otro fotograma.") }
        return insufficient("La zona sugerida no tiene detalle suficiente. Marca la zona visible en ambos planos.")
    }
    let used = ["left": leftRegion, "right": rightRegion]
    do {
        let a = try crop(left, leftRegion), b = try crop(right, rightRegion)
        let ca = try colorStatistics(a), cb = try colorStatistics(b)
        if ca.variance < 0.0007 || cb.variance < 0.0007 {
            return insufficient("Una zona tiene muy poco detalle visible para comparar.", regions: used)
        }
        let pa = try feature(a), pb = try feature(b)
        var measured = Float(0)
        try pa.computeDistance(&measured, to: pb)
        let distance = Double(measured)
        let color = zip(ca.mean, cb.mean).reduce(0.0) { $0 + abs($1.0 - $1.1) } / 3
        guard distance.isFinite, color.isFinite else { return insufficient("No se pudo obtener una medida estable.", regions: used) }
        let threshold = category == "face" ? 0.42 : (category == "wardrobe" ? 0.45 : 0.50)
        let similar = category == "face" ? 0.18 : (category == "wardrobe" ? 0.20 : 0.22)
        let status: String
        if distance >= threshold || color >= 0.18 { status = "possible-change" }
        else if distance <= similar && color <= 0.10 { status = "no-obvious-change" }
        else { status = "insufficient" }
        let labels = ["face": "rostro", "wardrobe": "vestuario", "object": "objeto"]
        let label = labels[category] ?? category
        var message: String
        if status == "possible-change" {
            message = "Posible diferencia visual en \(label). Revisa también pose, luz y encuadre antes de decidir."
        } else if status == "no-obvious-change" {
            message = "No se observa una diferencia marcada en esta zona; no confirma identidad ni continuidad completa."
        } else {
            message = "La diferencia de esta zona no es concluyente. Revisa la comparación o ajusta los fotogramas."
        }
        if category == "wardrobe" && (pair?.left == nil || pair?.right == nil) { message += " La zona de torso es una sugerencia geométrica; comprueba el recorte." }
        return Check(category: category, status: status, distance: distance, colorDelta: color,
                     threshold: threshold, similarThreshold: similar, regions: used, origin: origin, message: message)
    } catch {
        return insufficient(error.localizedDescription, regions: used)
    }
}

let started = Date()
do {
    guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--input" else {
        throw WorkerError(message: "Uso: filmma-continuity --input solicitud.json")
    }
    let input = try JSONDecoder().decode(Input.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
    let categories = input.categories ?? ["face", "wardrobe", "object"]
    guard !categories.isEmpty, categories.count <= 3, Set(categories).count == categories.count,
          categories.allSatisfy({ ["face", "wardrobe", "object"].contains($0) }) else {
        throw WorkerError(message: "Las categorías de comparación no son válidas.")
    }
    let left = try loadImage(input.leftPath), right = try loadImage(input.rightPath)
    let detectedLeft = try faces(left), detectedRight = try faces(right)
    let checks = categories.map { category in
        autoreleasepool { compare(category, input, left, right, detectedLeft, detectedRight) }
    }
    let result = Output(version: 1, engine: "apple-vision-cpu", featureRevision: 2,
        faces: ["left": detectedLeft.map(\.region), "right": detectedRight.map(\.region)],
        imageSizes: ["left": ["width": left.width, "height": left.height], "right": ["width": right.width, "height": right.height]],
        checks: checks, elapsedMs: Date().timeIntervalSince(started) * 1000,
        limitations: ["Umbrales heurísticos, no calibrados como reconocimiento de identidad.",
            "Pose, iluminación, encuadre y oclusiones pueden producir diferencias.",
            "La comparación sólo cubre las zonas y fotogramas elegidos; no inspecciona toda la duración ni la composición final.",
            "Los objetos se comparan mediante zonas manuales; no se detecta semánticamente su presencia o ausencia."])
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    print(String(data: try encoder.encode(result), encoding: .utf8)!)
} catch {
    let json: [String: String] = ["error": "CONTINUITY_ANALYSIS_FAILED", "message": error.localizedDescription]
    let data = try! JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    exit(1)
}
