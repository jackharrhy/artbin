# Library navigation and search

## Sub-features

Folder/file browsing, view switching, search, tag filters, pagination, and file detail navigation.

## How to get to it (user POV)

Open `/folders`, enter a query in the visible search field, submit Search, and open a matching folder or file.

## Driving it with Playwright

Use the labelled search field and Search button. Assert the query in the URL and a known matching result; also use a nonsense query to assert the empty state. Capture both states.

## Gotchas

The placeholder follows the active view (`Search folders`, `Search files`, or another plural noun). Do not assume a result exists without first creating an isolated fixture.
