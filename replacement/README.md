# 更換小記

這是與根目錄「用藥小記」分開的手機網頁，網址為 `https://neilnneil.github.io/medication-diary/replacement/`。用於記錄貓砂與隱形眼鏡的開始使用日期、實際更換日期，以及預計下次更換日期。預設每 1 個月更換一次，可在「管理項目」調整為任意天數、週數或月數，也可新增項目。月份以曆月計算；例如 1 月 31 日加 1 個月會落在 2 月最後一天。

## Google 試算表設定

本工具在瀏覽器以 Google Identity Services 取得短期 OAuth 存取權，直接呼叫 Google Sheets API。Google 試算表是雲端紀錄，手機 `localStorage` 是副本和離線待同步佇列。未登入 Google 或網路中斷時仍可記錄；畫面會顯示待同步筆數。重新連結後會先讀取試算表、排除重複事件，再上傳待同步資料。每筆事件都有獨立 ID；若上次上傳成功但回應中斷，下次同步不會把同一事件算兩次。

1. 使用自己的 Google 帳號，在 [Google Cloud Console](https://console.cloud.google.com/) 建立專案。
2. 啟用 [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)。
3. 在 **Google Auth Platform** 設定同意畫面。一般個人 Google 帳號選 **外部**，若維持測試狀態，將自己的帳號加入測試使用者。
4. 建立 **網頁應用程式** OAuth 用戶端，將 `https://neilnneil.github.io` 加入 **已授權的 JavaScript 來源**。本機開發可另外加入 `http://localhost:8765`。
5. 在網頁「同步設定」貼上 **用戶端 ID**。首次使用時「試算表網址或 ID」留空，儲存後按 **連結 Google**。Google 授權後，程式會在你的 Google 雲端硬碟建立私人試算表並同步紀錄。
6. 換手機時用同一個 Google 帳號開啟網頁，貼入原試算表的網址或 ID，再按 **連結 Google**。

只需要 OAuth **用戶端 ID**，不要將用戶端密鑰或服務帳號私鑰放入網頁或 GitHub。程式申請 `drive.file` 權限，用於讀寫由此應用建立的試算表；不會將試算表公開。Google 的瀏覽器授權有期限，每次重新開啟網頁通常要再次按「連結 Google」，才會讀取最新雲端資料。

「使用日期」代表當前用品開始使用的時間；「更換日期」代表實際把舊用品換掉的時間。記錄更換時，可另填新用品開始使用的時間，預計下次更換日從該時間開始計算。修改更換週期後，預計日期會重算，過去的事件仍保留在試算表。

此網頁沒有關閉後的系統推播。GitHub Pages 只負責提供網頁；Google Sheets 只保存資料，不會定時執行提醒。
