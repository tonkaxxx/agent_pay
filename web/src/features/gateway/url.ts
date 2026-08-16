const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

export interface UpstreamUrl {
  readonly protocol: "https:";
  readonly hostname: string;
  readonly pathname: string;
  readonly normalized: string;
}

export class InvalidUpstreamUrlError extends Error {
  constructor(reason: string) {
    super(`Invalid upstream URL: ${reason}`);
    this.name = "InvalidUpstreamUrlError";
  }
}

export function canonicalizeUpstreamUrl(value: string): UpstreamUrl {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidUpstreamUrlError("empty");
  }
  const raw = value.trim();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidUpstreamUrlError("unparseable");
  }

  if (url.protocol !== "https:") {
    throw new InvalidUpstreamUrlError("must use https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new InvalidUpstreamUrlError("must not contain credentials");
  }
  if (url.hash !== "") {
    throw new InvalidUpstreamUrlError("must not contain a fragment");
  }
  if (url.search !== "") {
    throw new InvalidUpstreamUrlError("must not contain query parameters");
  }
  if (url.port !== "") {
    throw new InvalidUpstreamUrlError("must not contain a port");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "" || CONTROL_OR_SPACE.test(hostname) || hostname.includes("\\")) {
    throw new InvalidUpstreamUrlError("invalid hostname");
  }
  const pathname = url.pathname;
  if (pathname === "" || !pathname.startsWith("/") || CONTROL_OR_SPACE.test(pathname)) {
    throw new InvalidUpstreamUrlError("invalid path");
  }

  url.pathname = pathname;
  url.search = "";
  url.hash = "";

  return {
    protocol: "https:",
    hostname,
    pathname,
    normalized: url.href,
  };
}