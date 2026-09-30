/** Personal post and story audience. Community posts are not in this set. */

export type PersonalAudience = "public" | "friends" | "only_me";

export function audienceLabel(audience: PersonalAudience): string {
  switch (audience) {
    case "public":
      return "Public";
    case "friends":
      return "Friends";
    case "only_me":
      return "Only me";
    default: {
      const unreachable: never = audience;
      return unreachable;
    }
  }
}

/** Explains who can see it without calling the Friends audience a Followers list. */
export function audienceHint(audience: PersonalAudience): string {
  switch (audience) {
    case "public":
      return "Anyone can see this.";
    case "friends":
      return "People who follow you can see this. It is not your Followers list.";
    case "only_me":
      return "Only you can see this.";
    default: {
      const unreachable: never = audience;
      return unreachable;
    }
  }
}

/** Stamp for a card. Public and older posts carry no extra label. */
export function limitedAudienceLabel(audience: PersonalAudience | undefined): "Friends" | "Only me" | null {
  switch (audience) {
    case "friends":
      return "Friends";
    case "only_me":
      return "Only me";
    case "public":
    case undefined:
      return null;
    default: {
      const unreachable: never = audience;
      return unreachable;
    }
  }
}

export function audienceTestId(prefix: string, audience: PersonalAudience): string {
  switch (audience) {
    case "public":
      return `${prefix}-public`;
    case "friends":
      return `${prefix}-friends`;
    case "only_me":
      return `${prefix}-only-me`;
    default: {
      const unreachable: never = audience;
      return unreachable;
    }
  }
}
