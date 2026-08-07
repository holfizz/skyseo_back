/**
 * Публичный ключ проверки подписи бандлов. Копия из skyseo_app/src/main/algo/pubkey.ts.
 * НЕ секретный. Используется только для отбраковки мусора при загрузке — источник доверия
 * это проверка в приложении. При смене ключа обнови оба файла.
 */
export const ALGO_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAF4zgAShFyz0j2keWrPFWMvR8qO2Gey//XkhQ6sniD/g=\n-----END PUBLIC KEY-----\n"
