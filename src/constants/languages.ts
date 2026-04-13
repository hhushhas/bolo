export const languageOptions = [
  { code: 'auto', label: 'Auto detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'ur', label: 'Urdu' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'hi', label: 'Hindi' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'tr', label: 'Turkish' },
] as const;

export const defaultSourceLanguage = languageOptions[0];
export const defaultTargetLanguage = languageOptions[1];

export const getLanguageLabel = (code: string) =>
  languageOptions.find((language) => language.code === code)?.label ?? code;
