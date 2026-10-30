import { t, type LocalePreference } from "../../i18n";
import { useLocale } from "../../state/locale";
import { OptionList, type OptionListOption } from "./OptionList";

const LOCALE_OPTION_ITEMS = (): OptionListOption<LocalePreference>[] => [
  { id: "system", label: t("localePicker.system"), title: t("localePicker.systemTitle") },
  { id: "en", label: t("localePicker.english"), title: t("localePicker.englishTitle") },
  { id: "zh-CN", label: t("localePicker.simplifiedChinese"), title: t("localePicker.simplifiedChineseTitle") },
  { id: "zh-TW", label: t("localePicker.traditionalChinese"), title: t("localePicker.traditionalChineseTitle") },
];

/** UI language choice shared by Settings and first run. Switching is live. */
export function LanguagePicker() {
  const { preference, setPreference } = useLocale();
  return (
    <OptionList<LocalePreference>
      value={preference}
      options={LOCALE_OPTION_ITEMS()}
      onChange={setPreference}
      label={t("localePicker.label")}
    />
  );
}
