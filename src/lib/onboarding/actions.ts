"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { checkBirthDate, isValidUsername, normalizeUsername, GENDERS } from "@/lib/validation/auth";
import { DATING_INTERESTS, LANGUAGES, LOOKING_FOR, MESSAGE_POLICIES } from "@/lib/types";
import { TR_CITIES } from "@/lib/data/cities";

/**
 * Başlangıç soruları: her "Devam"da ilgili adım kaydedilir (sayfa yenilense de
 * ilerleme kaybolmaz). Asıl kurallar veritabanında da uygulanır; burada
 * kullanıcıya anlamlı hata kodları üretmek için ön doğrulama yapılır.
 */

export type OnboardingErrorCode =
  | "generic"
  | "looking_for_required"
  | "dating_consent_required"
  | "dating_interest_required"
  | "display_name_required"
  | "username_invalid"
  | "username_taken"
  | "birth_date_invalid"
  | "underage"
  | "gender_required"
  | "terms_required"
  | "city_required"
  | "hobbies_required"
  | "too_many_hobbies"
  | "languages_required"
  | "bio_too_long"
  | "occupation_too_long";

export type OnboardingResult = { ok: true } | { ok: false; error: OnboardingErrorCode };

const lookingForSchema = z.object({
  step: z.literal("looking_for"),
  lookingFor: z.array(z.enum(LOOKING_FOR)).min(1).max(LOOKING_FOR.length),
});

const datingSchema = z.object({
  step: z.literal("dating"),
  lookingFor: z.array(z.enum(LOOKING_FOR)).min(1),
  datingInterest: z.array(z.enum(DATING_INTERESTS)).min(1).max(3),
  consent: z.literal(true),
});

const basicsSchema = z.object({
  step: z.literal("basics"),
  displayName: z.string().trim().min(1).max(40),
  username: z.string(),
  gender: z.enum(GENDERS),
  birthDate: z.string().optional(),
  acceptTerms: z.boolean().optional(),
});

const locationSchema = z.object({
  step: z.literal("location"),
  city: z.enum(TR_CITIES),
  district: z.string().trim().max(60),
});

const hobbiesSchema = z.object({
  step: z.literal("hobbies"),
  hobbyIds: z.array(z.number().int().positive()).min(1).max(15),
});

const languagesSchema = z.object({
  step: z.literal("languages"),
  languages: z.array(z.enum(LANGUAGES)).min(1).max(10),
});

const aboutSchema = z.object({
  step: z.literal("about"),
  bio: z.string().max(500),
  occupation: z.string().max(80),
});

const privacySchema = z.object({
  step: z.literal("privacy"),
  showInDiscover: z.boolean(),
  showAge: z.boolean(),
  showDistrict: z.boolean(),
  showGender: z.boolean(),
  showOnline: z.boolean(),
  messagePolicy: z.enum(MESSAGE_POLICIES),
});

const stepSchema = z.discriminatedUnion("step", [
  lookingForSchema,
  datingSchema,
  basicsSchema,
  locationSchema,
  hobbiesSchema,
  languagesSchema,
  aboutSchema,
  privacySchema,
]);

export type OnboardingStepInput = z.input<typeof stepSchema>;

/** Veritabanı hata mesajını (raise exception '...') bilinen bir koda çevirir. */
function dbError(message: string | undefined): OnboardingErrorCode {
  const known: OnboardingErrorCode[] = [
    "dating_consent_required",
    "dating_interest_required",
    "display_name_required",
    "terms_required",
    "city_required",
    "looking_for_required",
    "too_many_hobbies",
    "underage",
  ];
  const hit = known.find((k) => message?.includes(k));
  if (hit) return hit;
  if (message?.includes("birth_date_required")) return "birth_date_invalid";
  return "generic";
}

export async function saveOnboardingStep(input: OnboardingStepInput): Promise<OnboardingResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "generic" };

  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) {
    const step = (input as { step?: string })?.step;
    const byStep: Record<string, OnboardingErrorCode> = {
      looking_for: "looking_for_required",
      dating: "dating_consent_required",
      basics: "display_name_required",
      location: "city_required",
      hobbies: "hobbies_required",
      languages: "languages_required",
      about: "bio_too_long",
    };
    return { ok: false, error: byStep[step ?? ""] ?? "generic" };
  }

  const data = parsed.data;
  const supabase = await createClient();
  const updateProfile = async (values: Record<string, unknown>) => {
    const { error } = await supabase.from("profiles").update(values).eq("id", userId);
    return error;
  };

  switch (data.step) {
    case "looking_for": {
      // Flört, rıza adımında (dating) kaydedilir. Burada flört dışındakiler
      // kaydedilir; flört seçimi kaldırıldıysa veritabanı rızayı da siler.
      const withoutFlirt = data.lookingFor.filter((v) => v !== "flirt");
      const { data: current } = await supabase
        .from("profiles")
        .select("looking_for")
        .eq("id", userId)
        .single();
      const hadFlirt = (current?.looking_for as string[] | undefined)?.includes("flirt");
      const keepFlirt = hadFlirt && data.lookingFor.includes("flirt");
      const next = keepFlirt ? [...withoutFlirt, "flirt"] : withoutFlirt;
      if (next.length === 0) {
        // Yalnızca flört seçildi: rıza adımında kaydedilecek.
        return { ok: true };
      }
      const error = await updateProfile({ looking_for: next });
      return error ? { ok: false, error: dbError(error.message) } : { ok: true };
    }

    case "dating": {
      if (!data.lookingFor.includes("flirt")) return { ok: false, error: "generic" };
      // 1) Açık rıza + ilgi tercihi ayrı, kimsenin okuyamadığı tabloya yazılır
      //    (CLAUDE.md kural 11), 2) ardından flört seçimi kaydedilir.
      const consent = await supabase.rpc("set_dating_preferences", {
        p_interested_in: data.datingInterest,
      });
      if (consent.error) return { ok: false, error: dbError(consent.error.message) };
      const error = await updateProfile({ looking_for: data.lookingFor });
      return error ? { ok: false, error: dbError(error.message) } : { ok: true };
    }

    case "basics": {
      const username = normalizeUsername(data.username);
      if (!isValidUsername(username)) return { ok: false, error: "username_invalid" };

      const { data: priv } = await supabase
        .from("profile_private")
        .select("birth_date, terms_accepted_at")
        .eq("id", userId)
        .single();

      if (!priv?.birth_date) {
        const check = checkBirthDate(data.birthDate ?? "");
        if (check.result === "invalid") return { ok: false, error: "birth_date_invalid" };
        // 18 yaş altı da veritabanına gönderilir: hesap kalıcı olarak işaretlenir.
        const { data: result, error } = await supabase.rpc("set_birth_date", {
          p_birth_date: check.iso,
        });
        if (error) return { ok: false, error: "generic" };
        if (result === "underage") {
          await supabase.auth.signOut();
          const locale = await getLocale();
          redirect({ href: "/account-blocked", locale });
        }
        if (result !== "ok" && result !== "already_set") return { ok: false, error: "birth_date_invalid" };
      }

      if (!priv?.terms_accepted_at) {
        if (!data.acceptTerms) return { ok: false, error: "terms_required" };
        const { error } = await supabase
          .from("profile_private")
          .update({ terms_accepted_at: new Date().toISOString() })
          .eq("id", userId);
        if (error) return { ok: false, error: "generic" };
      }

      const error = await updateProfile({
        display_name: data.displayName,
        username,
        gender: data.gender,
      });
      if (error) {
        if (error.code === "23505") return { ok: false, error: "username_taken" };
        return { ok: false, error: dbError(error.message) };
      }
      return { ok: true };
    }

    case "location": {
      const error = await updateProfile({ city: data.city, district: data.district || null });
      return error ? { ok: false, error: dbError(error.message) } : { ok: true };
    }

    case "hobbies": {
      const ids = [...new Set(data.hobbyIds)];
      const { data: current } = await supabase
        .from("profile_hobbies")
        .select("hobby_id")
        .eq("profile_id", userId);
      const have = new Set((current ?? []).map((r: { hobby_id: number }) => r.hobby_id));
      const toRemove = [...have].filter((id) => !ids.includes(id));
      const toAdd = ids.filter((id) => !have.has(id));
      if (toRemove.length) {
        const { error } = await supabase
          .from("profile_hobbies")
          .delete()
          .eq("profile_id", userId)
          .in("hobby_id", toRemove);
        if (error) return { ok: false, error: "generic" };
      }
      if (toAdd.length) {
        const { error } = await supabase
          .from("profile_hobbies")
          .insert(toAdd.map((hobby_id) => ({ profile_id: userId, hobby_id })));
        if (error) return { ok: false, error: dbError(error.message) };
      }
      return { ok: true };
    }

    case "languages": {
      const error = await updateProfile({ languages: data.languages });
      return error ? { ok: false, error: dbError(error.message) } : { ok: true };
    }

    case "about": {
      const error = await updateProfile({ bio: data.bio || null, occupation: data.occupation || null });
      return error ? { ok: false, error: dbError(error.message) } : { ok: true };
    }

    case "privacy": {
      const error = await updateProfile({
        show_in_discover: data.showInDiscover,
        show_age: data.showAge,
        show_district: data.showDistrict,
        show_gender: data.showGender,
        show_online: data.showOnline,
        message_policy: data.messagePolicy,
      });
      if (error) return { ok: false, error: dbError(error.message) };

      // Tamamla: veritabanı zorunlu alanları (ad, şehir, yaş, koşullar,
      // flört rızası) burada son kez denetler.
      const done = await updateProfile({ onboarding_completed_at: new Date().toISOString() });
      if (done) return { ok: false, error: dbError(done.message) };

      const locale = await getLocale();
      redirect({ href: "/discover", locale });
      return { ok: true };
    }
  }
}

/** Flört seçimini geri al: rıza ve ilgi bilgisi veritabanında silinir. */
export async function removeFlirt(): Promise<OnboardingResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_dating_consent");
  return error ? { ok: false, error: "generic" } : { ok: true };
}
