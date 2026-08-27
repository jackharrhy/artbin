# Folders and uploads

## Sub-features

Folder creation, nested folders, individual uploads, directory uploads, archive import, moderation, download, and deletion.

## How to get to it (user POV)

Open `/folders`, choose Add, create a folder, open it, choose Upload, select files, and submit the upload.

## Driving it with Playwright

Use button roles and form labels. Set files on the first file input after opening the upload modal. Assert the visible filename, its database row, and exact bytes beneath the isolated uploads directory.

## Gotchas

Root uploads only accept supported archives for administrators. Ordinary files must be uploaded inside a folder. Uploads mutate both SQLite and disk, so always use the managed isolated runner.
