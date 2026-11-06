const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const isEmail = (v: string) => v.length <= 254 && EMAIL_RE.test(v);
