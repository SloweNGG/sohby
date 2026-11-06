import { getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, GraduationCap, Lock, MapPin, MessageSquare, User } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ablativeSuffix } from "@/lib/i18n/turkish";
import { ProfilePhoto } from "@/components/profile/avatar";
import { ComposeButton, ComposeProvider, IdeaButton } from "@/components/profile/compose";
import { SafetyActions } from "@/components/safety/safety-actions";
import { AnonComposeButton } from "@/components/anon/anon-compose";
import { Tag } from "@/components/ui/chip";
import { buttonClasses } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";
import { cn } from "@/lib/cn";
import type { ProfileDetail } from "@/lib/types";

/** Kişi profili (masaüstü: tasarim/07, telefon: tasarim/15). */
export async function ProfileView({
  p,
  locale,
  autoCompose = false,
}: {
  p: ProfileDetail;
  locale: Locale;
  autoCompose?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "profile" });
  const tl = await getTranslations({ locale, namespace: "lookingFor" });
  const tg = await getTranslations({ locale, namespace: "auth.gender" });
  const ta = await getTranslations({ locale, namespace: "app" });

  const hobbyName = (h: ProfileDetail["hobbies"][number]) => (locale === "tr" ? h.name_tr : h.name_en);
  const nameLine = p.age !== null ? `${p.display_name}, ${p.age}` : p.display_name;
  const place = [p.district, p.city].filter(Boolean).join(", ");
  const since = new Date(p.member_since);
  const sinceText = t("memberSince", {
    date: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(since),
    suffix: ablativeSuffix(since.getUTCFullYear()),
  });
  const languageNames = new Intl.DisplayNames([locale], { type: "language" });
  const langLabel = (code: string) => {
    const n = languageNames.of(code) ?? code;
    return n.charAt(0).toLocaleUpperCase(locale) + n.slice(1);
  };

  // Sohbet başlatma fikri: önce ortak hobi, yoksa ilk hobi.
  const ideaHobby = p.hobbies.find((h) => h.common) ?? p.hobbies[0];
  const ideaQuestion = ideaHobby
    ? t.has(`ideaQuestions.${ideaHobby.slug}` as never)
      ? t(`ideaQuestions.${ideaHobby.slug}` as never)
      : t("ideaQuestion")
    : null;
  const idea =
    ideaHobby && ideaQuestion
      ? {
          text: t(ideaHobby.common ? "ideaCommon" : "ideaGeneric", {
            hobby: hobbyName(ideaHobby).toLocaleLowerCase(locale),
            question: ideaQuestion,
          }),
          prefill: t(ideaHobby.common ? "ideaMessageCommon" : "ideaMessageGeneric", {
            hobby: hobbyName(ideaHobby).toLocaleLowerCase(locale),
          }),
        }
      : null;

  const canCompose = !p.is_self && (p.message_mode === "direct" || p.message_mode === "request") && !p.outgoing_request_pending && !p.incoming_request_id;
  const lookingFor = p.looking_for;

  // Birincil eylem (masaüstü ve telefon için aynı mantık)
  const primaryAction = (variant: "desktop" | "mobile") => {
    const cls = cn(
      buttonClasses({ size: "lg", className: "font-semibold" }),
      variant === "mobile" ? "h-[50px] flex-1" : "px-8",
    );
    if (p.is_self) return null;
    if (p.conversation_id) {
      return (
        <Link href={`/chats/${p.conversation_id}`} className={cls}>
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
          {t("openChat")}
        </Link>
      );
    }
    if (p.incoming_request_id) {
      return (
        <Link href={`/chats/requests/${p.incoming_request_id}`} className={cls}>
          {t("viewRequest")}
        </Link>
      );
    }
    if (p.outgoing_request_pending) {
      return (
        <span className={cn(buttonClasses({ variant: "outline", size: "lg" }), variant === "mobile" && "flex-1", "cursor-default")}>
          {t("requestSent")}
        </span>
      );
    }
    if (p.message_mode === "not_allowed") {
      return <p className="text-sm text-muted">{t("notAllowed")}</p>;
    }
    return (
      <ComposeButton className={cls}>
        {variant === "mobile" && <MessageSquare className="h-5 w-5" aria-hidden="true" />}
        {variant === "mobile" ? t("sendMessage") : t("sayHi")}
      </ComposeButton>
    );
  };

  const content = (
    <main className="pb-28 md:px-10 md:pb-12 md:pt-6">
      <div className="hidden md:block">
        <BackLink label={t("back")} />
      </div>

      {/* Telefon: tam genişlik görsel + üst butonlar (tasarim/15) */}
      <div className="relative md:hidden">
        <ProfilePhoto id={p.id} url={p.photo_url} alt={t("photoAlt", { name: p.display_name })} className="h-[330px] w-full" />
        <Link
          href="/discover"
          className="absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-night/80"
          aria-label={t("back")}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        {!p.is_self && (
          <div className="absolute right-4 top-4">
            <SafetyActions
              variant="menu"
              targetId={p.id}
              name={p.display_name}
              afterBlockHref="/discover"
              menuClassName="border-transparent bg-night/80"
            />
          </div>
        )}
      </div>

      <div className="mx-auto mt-0 grid max-w-[1120px] gap-8 px-4 md:mt-6 md:grid-cols-[440px_minmax(0,1fr)] md:gap-10 md:px-0">
        <ProfilePhoto id={p.id} url={p.photo_url} alt={t("photoAlt", { name: p.display_name })} className="hidden h-[550px] rounded-[28px] md:block" />

        <section className="pt-5 md:pt-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[32px] font-extrabold leading-none tracking-[-0.055em] md:text-[56px]">{nameLine}</h1>
            {p.is_online && (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-online md:hidden">
                <span className="h-2 w-2 rounded-full bg-online" aria-hidden="true" />
                {t("online")}
              </span>
            )}
          </div>
          {p.is_online && (
            <p className="mt-3 hidden items-center gap-2 font-semibold text-online md:flex">
              <span className="h-2 w-2 rounded-full bg-online" aria-hidden="true" />
              {t("onlineNow")}
            </p>
          )}

          {/* Telefon: tek satır özet */}
          <p className="mt-3 text-[15px] text-muted md:hidden">
            {[place, p.occupation].filter(Boolean).join(". ")}
          </p>

          {/* Masaüstü: ikonlu bilgi satırları */}
          <ul className="mt-6 hidden space-y-2.5 text-[17px] md:block">
            {place && (
              <InfoRow icon={<MapPin className="h-[18px] w-[18px]" />}>{place}</InfoRow>
            )}
            {p.occupation && (
              <InfoRow icon={<GraduationCap className="h-[18px] w-[18px]" />}>{p.occupation}</InfoRow>
            )}
            {p.gender && <InfoRow icon={<User className="h-[18px] w-[18px]" />}>{tg(p.gender)}</InfoRow>}
            <InfoRow icon={<CalendarDays className="h-[18px] w-[18px]" />}>{sinceText}</InfoRow>
          </ul>

          {lookingFor.length > 0 && (
            <div className="mt-5 hidden flex-wrap items-center gap-2 md:flex">
              <span className="text-sm text-muted">{t("lookingFor")}</span>
              {lookingFor.map((l) => (
                <Tag key={l} className={l === "flirt" ? "border-coral text-coral-text" : undefined}>
                  {tl(l)}
                </Tag>
              ))}
            </div>
          )}

          {p.is_self ? (
            <div className="mt-8 rounded-[var(--radius-card)] border border-edge bg-surface p-5">
              <p className="font-semibold">{t("selfTitle")}</p>
              <p className="mt-1 text-sm text-muted">{t("selfBody")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/profile/edit" className={buttonClasses({ size: "sm" })}>
                  {t("editProfile")}
                </Link>
              </div>
              <form action={signOutAction} className="mt-3">
                <button type="submit" className={buttonClasses({ variant: "outline", size: "sm" })}>
                  {ta("signOut")}
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-center gap-3 md:mt-8">
                <span className="contents md:hidden">{primaryAction("mobile")}</span>
                <span className="hidden md:contents">{primaryAction("desktop")}</span>
                {!p.conversation_id && !p.incoming_request_id && !p.outgoing_request_pending && (
                  <>
                    <span className="contents md:hidden">
                      <AnonComposeButton targetId={p.id} name={p.display_name} variant="mobile" />
                    </span>
                    <span className="hidden md:contents">
                      <AnonComposeButton targetId={p.id} name={p.display_name} />
                    </span>
                  </>
                )}
              </div>
              {p.outgoing_request_pending && <p className="mt-2 text-sm text-muted">{t("requestSentHint")}</p>}
              {p.incoming_request_id && <p className="mt-2 text-sm text-muted">{t("incomingRequest")}</p>}
              <div className="mt-6 hidden md:block">
                <SafetyActions variant="links" targetId={p.id} name={p.display_name} afterBlockHref="/discover" />
              </div>
            </>
          )}
        </section>
      </div>

      <div className="mx-auto max-w-[1120px] px-4 md:px-0">
        {idea && canCompose && (
          <div className="mt-6 flex flex-col gap-4 rounded-[var(--radius-card)] bg-night-deep p-4 md:mt-8 md:flex-row md:items-center md:justify-between md:px-6 md:py-5">
            <div>
              <p className="text-[13px] font-semibold text-coral-text">{t("ideaTitle")}</p>
              <p className="mt-1 font-semibold leading-snug md:text-lg">{idea.text}</p>
            </div>
            <IdeaButton
              prefill={idea.prefill}
              className={buttonClasses({ variant: "danger", size: "md", className: "shrink-0 font-semibold" })}
            >
              {t("useIdea")}
            </IdeaButton>
          </div>
        )}

        <div className="mt-6 grid gap-4 md:mt-8 md:grid-cols-3 md:gap-5">
          <Card title={t("about")}>
            <p className={cn("leading-relaxed", p.bio ? "text-moon" : "text-muted")}>{p.bio ?? t("noBio")}</p>
          </Card>
          {p.hobbies.length > 0 && (
            <Card title={t("hobbies")}>
              <div className="flex flex-wrap gap-2">
                {p.hobbies.map((h) => (
                  <Tag key={h.slug} highlight={h.common}>
                    {hobbyName(h)}
                  </Tag>
                ))}
              </div>
              {p.common_hobby_count > 0 && (
                <p className="mt-4 text-sm font-semibold text-coral-text">{t("commonCount", { count: p.common_hobby_count })}</p>
              )}
            </Card>
          )}
          {p.languages.length > 0 && (
            <Card title={t("languages")}>
              <div className="flex flex-wrap gap-2">
                {p.languages.map((l) => (
                  <Tag key={l}>{langLabel(l)}</Tag>
                ))}
              </div>
            </Card>
          )}
        </div>

        {!p.is_self && (
          <p className="mt-6 flex items-start gap-2 text-sm text-muted">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("privacyNote", { name: p.display_name })}
          </p>
        )}
      </div>
    </main>
  );

  if (!canCompose) return content;
  return (
    <ComposeProvider
      targetId={p.id}
      name={p.display_name}
      mode={p.message_mode === "direct" ? "direct" : "request"}
      autoOpen={autoCompose}
      flirtAllowed={p.flirt_compatible}
    >
      {content}
    </ComposeProvider>
  );
}

export function BackLink({ label }: { label: string }) {
  return (
    <Link href="/discover" className="inline-flex items-center gap-1.5 text-[15px] text-muted hover:text-moon">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="text-moon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </li>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="md:rounded-[var(--radius-card)] md:bg-surface md:p-6">
      <h2 className="mb-3 text-lg md:mb-4 md:text-xl">{title}</h2>
      {children}
    </section>
  );
}
