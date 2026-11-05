// Convert explicit display notation into executable keyboard bindings. Never
// infer controls from action prose or silently accept undeclared test inputs.
function atom(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('Keyboard binding must contain a nonempty key of at most 40 characters.');
  return value.trim();
}
export function chord(value) {
  const key=atom(value);
  // A literal '+' is a key; 'Shift + KeyR' is a chord.
  const parts=key==='+' ? [key] : key.split(/\s*\+\s*/).map(atom);
  if(parts.some(p=>p.includes('/'))) throw new Error('Test inputs need one concrete binding, not slash-separated alternatives.');
  if(parts.length>6 || new Set(parts).size!==parts.length) throw new Error('Use at most six unique keys in a chord.');
  return parts;
}
export function normalizeControls(controls) {
  if(!Array.isArray(controls)) throw new Error('controls must be an array.');
  return controls.flatMap(control=>{
    if(Object.hasOwn(control,'key')===Object.hasOwn(control,'keys')) throw new Error('Each control needs exactly one of key or keys.');
    if(control.keys) {
      if(!Array.isArray(control.keys)||!control.keys.length) throw new Error('Control chord keys must be a nonempty array.');
      const keys=control.keys.map(atom);
      if(keys.some(k=>chord(k).length!==1)||keys.length>6||new Set(keys).size!==keys.length) throw new Error('Control chord must contain unique individual keys.');
      return [{...control,keys}];
    }
    const alternatives=atom(control.key).split('/').map(atom);
    return alternatives.map(alternative=>{
      const keys=chord(alternative);
      const {key:_key,...rest}=control;
      return keys.length===1 ? {...rest,key:keys[0]} : {...rest,keys};
    });
  });
}
export function normalizeTestInput(step) {
  if(!['press','hold','down','up'].includes(step.action)) return;
  if(Object.hasOwn(step,'key') && !Object.hasOwn(step,'keys') && typeof step.key==='string') {
    const keys=chord(step.key);
    if(keys.length>1) {delete step.key;step.keys=keys;} else step.key=keys[0];
  }
  if(Array.isArray(step.keys)) {
    step.keys=step.keys.map(atom);
    if(step.keys.some(k=>chord(k).length!==1)) throw new Error('Each simultaneous input must be an individual key; put chord components in the keys array.');
  }
}
export const declaredKeys=controls=>new Set(controls.flatMap(control=>control.keys || [control.key]));
