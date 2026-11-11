/** Profil doluluğu: kenar çubuğundaki "Profili tamamla" kutusu için. */
export const COMPLETION_ITEMS = ["photo", "bio", "hobbies", "district", "occupation"] as const;
export type CompletionItem = (typeof COMPLETION_ITEMS)[number];

export type ProfileCompletion = { percent: number; missing: CompletionItem[] };

type Input = {
  photo_id: string | null;
  bio: string | null;
  district: string | null;
  occupation: string | null;
  hobbyCount: number;
};

export function profileCompletion(p: Input): ProfileCompletion {
  const filled: Record<CompletionItem, boolean> = {
    photo: !!p.photo_id,
    bio: !!p.bio?.trim(),
    hobbies: p.hobbyCount > 0,
    district: !!p.district?.trim(),
    occupation: !!p.occupation?.trim(),
  };
  const missing = COMPLETION_ITEMS.filter((k) => !filled[k]);
  const percent = Math.round(((COMPLETION_ITEMS.length - missing.length) / COMPLETION_ITEMS.length) * 100);
  return { percent, missing };
}
