# Prompt for the Claude browser extension: remove the older duplicate script in Blogger and test the redirects

(2026-11-24) The old blog page holds two copies of the notice script (version 2.0.0 first, 2.1.0 second). The first one runs and has only one redirect, so the new redirects do nothing. Paste the prompt below into the extension (permission mode "Manually approve", Chrome profile signed in to Blogger). The copy to paste is in the chat message that created this file; the stages are: 1 look, 2 backup and delete only the 2.0.0 copy and Save, 3 test six redirects and three addresses that must stay, 4 report.

After it finishes, test again from the computer with a real browser (Playwright script in the session scratchpad: open four old addresses and print the final address).
