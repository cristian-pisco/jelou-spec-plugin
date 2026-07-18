import { classifyLogin, extractAuthCookie, cookieHeaderFromSetCookies } from '../../api-login.mjs';

export async function loginForCookie({ loginUrl, verifyMfaUrl, cookieName, email, password, postJson, readOtp }) {
  const login = await postJson(loginUrl, { email, password });
  let verdict = classifyLogin(login.status, login.json);
  let setCookies = login.setCookies;

  if (verdict.outcome === 'rejected') return { status: 'rejected', cookieValue: null };

  if (verdict.outcome === 'mfa') {
    const otp = await readOtp(email);
    if (!otp) return { status: 'otp-missing', cookieValue: null };
    const verify = await postJson(verifyMfaUrl, { email, code: otp, otpCode: otp }, { cookie: cookieHeaderFromSetCookies(login.setCookies) });
    verdict = classifyLogin(verify.status, verify.json);
    if (verdict.outcome !== 'ok') return { status: 'otp-rejected', cookieValue: null };
    setCookies = verify.setCookies;
  }

  const cookie = extractAuthCookie(setCookies, { domain: 'localhost' });
  if (!cookie || cookie.name !== cookieName) return { status: 'rejected', cookieValue: null };
  return { status: 'ok', cookieValue: cookie.value };
}
