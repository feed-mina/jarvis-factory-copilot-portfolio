/* digest.js — 입력 불변 검사용 지문 (D12 조건 7). 키 정렬 JSON → FNV-1a 64bit(32bit 두 번) hex.
 * 암호학적 용도가 아니라 "데이터가 바뀌었는가"를 알아채는 용도다 (Javis digest 와 같은 역할). */
export function stable(obj) {
  if (Array.isArray(obj)) return "[" + obj.map(stable).join(",") + "]";
  if (obj && typeof obj === "object") return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + stable(obj[k])).join(",") + "}";
  return JSON.stringify(obj);
}
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
export function digest(obj) { const s = stable(obj); return fnv1a(s, 0x811c9dc5) + fnv1a(s, 0x01000193); }
