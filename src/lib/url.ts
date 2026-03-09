export interface NormalizedUrl {
  url: string;
  path: string;
}

export function normalizeUrl(input: string): NormalizedUrl {
  if (!input) {
    return { url: '', path: '/' };
  }
  try {
    const parsed = new URL(input.trim());
    let pathname = parsed.pathname || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    const normalized =
      parsed.protocol && parsed.host
        ? `${parsed.protocol}//${parsed.host}${pathname}${parsed.search ? parsed.search : ''}`
        : input.trim();
    return {
      url: normalized,
      path: pathname || '/',
    };
  } catch {
    // Fallback: strip duplicate slashes, remove trailing slash
    const sanitized = input.trim().replace(/\s+/g, '');
    const withoutTrailing = sanitized.length > 1 && sanitized.endsWith('/') ? sanitized.slice(0, -1) : sanitized;
    const path = withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`;
    return {
      url: withoutTrailing || '/',
      path,
    };
  }
}
