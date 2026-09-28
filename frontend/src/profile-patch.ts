/** Fields the profile editor can change without uploading a new photo. */
export type ProfileText = {
  full_name: string;
  bio: string;
  about: string;
  sports: string[];
};

export type ProfileTextPatch = {
  full_name?: string;
  bio?: string;
  about?: string;
  sports?: string[];
};

function sameSports(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((tag, index) => tag === right[index]);
}

/**
 * Only fields that differ from the account we loaded. An empty draft that
 * never received `about` or `sports` must not be written back as a clear.
 */
export function profileTextPatch(baseline: ProfileText, draft: ProfileText): ProfileTextPatch {
  const body: ProfileTextPatch = {};
  const fullName = draft.full_name.trim();
  const bio = draft.bio.trim();
  const about = draft.about.trim();
  if (fullName !== baseline.full_name.trim()) body.full_name = fullName;
  if (bio !== baseline.bio.trim()) body.bio = bio;
  if (about !== baseline.about.trim()) body.about = about;
  if (!sameSports(draft.sports, baseline.sports)) body.sports = draft.sports;
  return body;
}
