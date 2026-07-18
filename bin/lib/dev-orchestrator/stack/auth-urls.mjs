export function resolveAuthUrls({ auth, hostByService }) {
  const dashHost = hostByService[auth.dashboardService];
  const base = `http://localhost:${dashHost}`;
  return {
    cookieName: auth.cookieName,
    loginUrl: `${base}${auth.loginPath}`,
    verifyMfaUrl: `${base}${auth.verifyMfaPath}`,
    verifyUrls: (auth.verify || []).map((v) => `http://localhost:${hostByService[v.service]}${v.path}`)
  };
}
