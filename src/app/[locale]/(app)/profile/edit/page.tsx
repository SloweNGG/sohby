import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/locale";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { ageFromBirthDate, getHobbyCatalog, getMyAccount } from "@/lib/profile";
import { signPhotoPaths } from "@/lib/photos";
import { ProfileEditForm } from "@/components/profile/profile-edit-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/profile/edit">): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: "profileEdit" });
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function ProfileEditPage({ params }: PageProps<"/[locale]/profile/edit">) {
  const locale = await resolveLocale(params);
  const account = await getMyAccount();
  if (!account) {
    redirect({ href: "/login", locale });
    return null;
  }
  const { profile, private: priv, hobbyIds } = account;
  const supabase = await createClient();
  const [hobbies, latest] = await Promise.all([
    getHobbyCatalog(),
    supabase
      .from("profile_photos")
      .select("storage_path, status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const photo = latest.data as { storage_path: string; status: "approved" | "pending" | "rejected" } | null;
  const urls = await signPhotoPaths([photo?.storage_path]);

  return (
    <main className="px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pb-12 md:pt-10">
      <ProfileEditForm
        hobbies={hobbies}
        initial={{
          id: profile.id,
          username: profile.username,
          age: ageFromBirthDate(priv.birth_date),
          displayName: profile.display_name ?? "",
          city: profile.city ?? "",
          district: profile.district ?? "",
          occupation: profile.occupation ?? "",
          gender: profile.gender,
          bio: profile.bio ?? "",
          hobbyIds,
          showAge: profile.show_age,
          showDistrict: profile.show_district,
          showOnline: profile.show_online,
          photoUrl: photo ? (urls.get(photo.storage_path) ?? null) : null,
          photoStatus: photo?.status ?? null,
        }}
      />
    </main>
  );
}
