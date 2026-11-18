export function sanitizeDiagnosticPath(path: string): string {
  // Remove query strings and fragments before decoding so credentials and other
  // query values can never enter the diagnostic path.
  const pathname = path.split(/[?#]/, 1)[0];
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Keep the original path if it contains malformed percent encoding.
  }

  return decoded.split('/').map((segment) => {
    if (!segment) return segment;
    if (
      /^\\d+$/.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
      /^[^\\s/@]+@[^\\s/@]+\\.[^\\s/@]+$/.test(segment) ||
      /^[A-Za-z0-9_-]{40,}$/.test(segment)
    ) return ':id';
    return segment;
  }).join('/');
}
