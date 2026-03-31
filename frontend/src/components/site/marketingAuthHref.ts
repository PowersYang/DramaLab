export type MarketingAuthMode = "signin" | "signup";

const toSearchParams = (search?: string | URLSearchParams) => {
  if (!search) {
    return new URLSearchParams();
  }
  if (typeof search === "string") {
    return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  }
  return new URLSearchParams(search.toString());
};

export const buildMarketingAuthHref = (
  pathname: string,
  search: string | URLSearchParams | undefined,
  mode: MarketingAuthMode,
  nextPath?: string,
) => {
  const params = toSearchParams(search);
  params.set("auth", mode);
  if (nextPath) {
    params.set("next", nextPath);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

export const stripMarketingAuthHref = (
  pathname: string,
  search: string | URLSearchParams | undefined,
) => {
  const params = toSearchParams(search);
  params.delete("auth");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};
