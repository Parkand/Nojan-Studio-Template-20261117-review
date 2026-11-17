// Browser-only protocol helper. A failed mutation is never retried automatically.
export class APIError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export async function request(route, input = {}) {
  let response;
  try {
    response = await fetch(`/api/studio/${route}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Nexora-Studio': '1' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new APIError('ارتباط قطع شد؛ نتیجهٔ عملیات نامشخص است. وضعیت پروژه را بررسی کنید؛ درخواست خودکار تکرار نشد.', 0);
  }
  let value;
  try { value = await response.json(); }
  catch { throw new APIError('پاسخ سرور قابل خواندن نیست؛ وضعیت را بررسی کنید. هیچ درخواست خودکاری تکرار نشد.', response.status); }
  if (!response.ok) throw new APIError(value.error || 'عملیات ناموفق بود.', response.status);
  return value;
}
