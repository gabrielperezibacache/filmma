import type {ColorAdjustments} from '../types';
import {colorMatrix} from '../visual-effects';

/** One sRGB matrix shared with the renderer; alpha remains untouched. */
export default function ColorFilter({id,color}:{id:string;color?:ColorAdjustments}) {
  return <svg width="0" height="0" aria-hidden="true" className="color-filter-defs"><defs><filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values={colorMatrix(color).join(' ')}/></filter></defs></svg>;
}
