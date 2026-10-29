/* Filmma's narrow driver for the pinned H3cApp C API. No global model cache. */
#include "h3.h"
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static volatile int cancelled = 0;
static FILE *raw_frames;
static double began;
static double seconds(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (double)t.tv_sec + (double)t.tv_nsec / 1e9; }
static void stop(int sig) { (void)sig; cancelled = 1; }
static int progress(const char *phase, int done, int total, void *opaque) {
    (void)opaque;
    printf("[filmma-h3-gguf] %.3fs %s %d/%d\n", seconds() - began, phase, done, total);
    return cancelled;
}
static int frame(const h3_frame *f, void *opaque) {
    (void)opaque;
    if (f->denoise_step < 0 && raw_frames && f->rgb)
        for (int row = 0; row < f->height; row++)
            if (fwrite(f->rgb + (size_t)row * f->stride, 1, (size_t)f->width * 3, raw_frames) != (size_t)f->width * 3)
                return 1;
    return cancelled;
}
static int invalid(const char *arg) { fprintf(stderr, "Invalid or missing argument: %s\n", arg); return 2; }
int main(int argc, char **argv) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    began = seconds();
    signal(SIGTERM, stop); signal(SIGINT, stop);
    h3_params p = {0};
    p.width = 512; p.height = 320; p.frames = 22; p.steps = 20; p.seed = 42;
    p.dit_layers = 50; p.denoise_reuse = 1; p.core_reuse = 1;
    p.ssd_streaming = 1; p.on_progress = progress; p.on_frame = frame;
    p.cancel_requested = &cancelled;
    const char *directory = NULL, *prompt = NULL, *raw = NULL;
    h3_reference refs[32] = {0}; size_t count = 0;
    for (int i = 1; i < argc; i++) {
        const char *key = argv[i];
        if (!strcmp(key, "--profile")) continue;
        if (!strcmp(key, "--ssd-streaming")) { p.ssd_streaming = 1; continue; }
        if (!strcmp(key, "--resident")) { p.ssd_streaming = 0; continue; }
        if (++i >= argc) return invalid(key);
        const char *value = argv[i];
        if (!strcmp(key, "-d")) directory = value;
        else if (!strcmp(key, "-p")) prompt = value;
        else if (!strcmp(key, "-o")) p.output_path = value;
        else if (!strcmp(key, "--width")) p.width = atoi(value);
        else if (!strcmp(key, "--height")) p.height = atoi(value);
        else if (!strcmp(key, "--frames")) p.frames = atoi(value);
        else if (!strcmp(key, "--steps")) p.steps = atoi(value);
        else if (!strcmp(key, "--seed")) p.seed = strtoull(value, NULL, 10);
        else if (!strcmp(key, "--layers")) p.dit_layers = atoi(value);
        else if (!strcmp(key, "--reuse")) p.denoise_reuse = atoi(value);
        else if (!strcmp(key, "--first-frame")) p.first_frame = value;
        else if (!strcmp(key, "--last-frame")) p.last_frame = value;
        else if (!strcmp(key, "--raw-frames")) raw = value;
        else if (!strcmp(key, "--ref-image") || !strcmp(key, "--ref-video") || !strcmp(key, "--ref-silent-video") || !strcmp(key, "--ref-audio")) {
            if (count >= 32) return invalid("too many references");
            refs[count].kind = !strcmp(key, "--ref-image") ? H3_REFERENCE_IMAGE : !strcmp(key, "--ref-audio") ? H3_REFERENCE_AUDIO : H3_REFERENCE_VIDEO;
            refs[count].include_embedded_audio = !strcmp(key, "--ref-video");
            refs[count++].path = value;
        } else return invalid(key);
    }
    if (!directory || !prompt || !p.output_path) return invalid("-d, -p and -o are required");
    if (p.width < 256 || p.height < 256 || p.width % 32 || p.height % 32 ||
        p.width > 1344 || p.height > 1344 || p.width * p.height > 1344 * 768 ||
        p.frames < 22 || p.frames > 345 || (p.frames - 5) % 17 || p.steps < 2 || p.steps > 100 ||
        p.dit_layers != 50 || p.denoise_reuse != 1) return invalid("profile outside Filmma limits");
    if (!access(p.output_path, F_OK) || (raw && !access(raw, F_OK))) return invalid("output exists; originals preserved");
    if (raw && !(raw_frames = fopen(raw, "wbx"))) return invalid("raw frame destination");
    p.references = refs; p.reference_count = count;
    h3_ctx *ctx = h3_load_dir(directory);
    if (!ctx) { fprintf(stderr, "Could not load GGUF model metadata\n"); if (raw_frames) fclose(raw_frames); return 1; }
    const h3_device_info *device = h3_device(ctx);
    printf("[filmma-h3-gguf] device=%s memory=%llu refs=%zu ssd=%d\n", device->name, (unsigned long long)device->physical_memory, count, p.ssd_streaming);
    h3_result *result = h3_generate(ctx, prompt, &p);
    int ok = result && !cancelled;
    if (!ok) fprintf(stderr, "MiniMax H3 GGUF: %s\n", h3_last_error(ctx));
    else printf("[filmma-h3-gguf] verified-engine-result %dx%d frames=%d fps=%d seed=%llu\n", result->width, result->height, result->frames, result->fps, (unsigned long long)result->seed);
    if (raw_frames && fclose(raw_frames)) ok = 0;
    if (result) h3_result_free(result);
    h3_free(ctx);
    return ok ? 0 : 1;
}
