import { getT } from "@/lib/i18n";
import { adminRpc } from "@/lib/supabase";
import { setAutoApproveAction, setChatPhotosAction, setChatVoiceAction } from "@/lib/actions";
import { AdminShell, btn } from "@/components/shell";

type S = { photo_auto_approve: boolean; chat_photos_enabled?: boolean; chat_voice_enabled?: boolean };

export default async function SettingsPage() {
  const settings = adminRpc<S>("admin_get_settings");
  return (
    <AdminShell>
      <Settings settings={settings} />
    </AdminShell>
  );
}

async function Settings({ settings }: { settings: ReturnType<typeof adminRpc<S>> }) {
  const { t } = getT();
  const s = (await settings).data;
  const toggles = [
    { action: setAutoApproveAction, label: t("photos.autoApprove"), hint: t("photos.autoApproveHint"), on: s?.photo_auto_approve ?? true },
    { action: setChatPhotosAction, label: t("photos.chatPhotos"), hint: t("photos.chatPhotosHint"), on: s?.chat_photos_enabled ?? false },
    { action: setChatVoiceAction, label: t("photos.chatVoice"), hint: t("photos.chatVoiceHint"), on: s?.chat_voice_enabled ?? true },
  ];
  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl">{t("settings.title")}</h1>
      <ul className="mt-6 space-y-3">
        {toggles.map(({ action, label, hint, on }) => (
          <li key={label} className="rounded-[20px] border border-edge bg-surface p-4">
            <form action={action} className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{label}</span>
              <span
                className={
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold " +
                  (on ? "bg-coral text-ink" : "border border-edge text-muted")
                }
              >
                {on ? t("photos.on") : t("photos.off")}
              </span>
              <input type="hidden" name="enabled" value={on ? "0" : "1"} />
              <button className={`${btn} ml-auto`}>{on ? t("settings.turnOff") : t("settings.turnOn")}</button>
              <p className="w-full text-sm text-muted">{hint}</p>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
