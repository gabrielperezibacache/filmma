"""Residency changes storage, not model precision, identity references or frames."""
def residency_plan(hardware, requested='auto', profile='conservative'):
    if requested not in ('auto', 'ssd', 'ram'):
        raise ValueError('Modo de memoria desconocido.')
    memory = hardware.get('memoryGB') or 0
    eligible = bool(hardware.get('appleSilicon') and memory >= 64)
    # Existing long/HD supervisors have a deliberately lower process budget.
    # Never remove that safeguard just to make residency selectable.
    supervised = profile != 'conservative'
    mode = ('ram' if eligible and memory >= 96 and not supervised else 'ssd') if requested == 'auto' else requested
    if mode == 'ram' and (not eligible or supervised):
        raise ValueError('RAM residente requiere Apple Silicon con al menos 64 GiB y el perfil breve. Se recomiendan 96 GiB. Los perfiles largos/HD conservan SSD streaming y sus límites de memoria.')
    return {'requested': requested, 'effective': mode, 'ssdStreaming': mode == 'ssd',
            'ramEligible': eligible, 'minimumRamGB': 64, 'recommendedRamGB': 96,
            'note': 'El transformador permanece residente; el codificador y la carga inicial aún leen el disco. No garantiza cero intercambio del sistema.'}
