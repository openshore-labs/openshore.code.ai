# Trademark policy

The OpenShore code is open source under the Apache License 2.0. The names
and logos are not. This page says what you may and may not do with them.

## What the marks are

These belong to Open Shore LLC:

- OpenShore, and the OpenShore logo and wordmark
- OS Code
- Harbor, Harbor Lite, and DeepBlue (the names of the built-in models)
- The app icon

The Apache License covers the code only. Its section 6 says it grants no
right to use these names, and this policy is how Open Shore LLC lets people
use them anyway in the cases below.

## Fine without asking

- Saying what is true: "built with OpenShore", "a fork of OpenShore",
  "works with OpenShore", "compatible with OS Code".
- Writing about OpenShore, reviewing it, teaching it, or linking to it.
- Building and running the code, unchanged or changed, for yourself or
  inside your own organization, under the OpenShore name.
- Sending changes back to this repository.

## Ask first

- Publishing a modified build to anyone else (an app store, a download
  page, a package registry) under any of the names above, or with the logo
  or app icon. A fork you distribute needs its own name and its own icon.
- Using a name above in your product's, company's, or domain's name.
- Anything that would make someone think Open Shore LLC made, checked, or
  supports your build when it did not.

Write to support@openshore.ai. Most reasonable asks get a yes.

## Official builds

Only Open Shore LLC publishes official OpenShore builds: the App Store
listing, the signed desktop releases, and the update feed. They are signed
with keys only Open Shore LLC holds (`app/electron/releaseKeys.ts` pins the
public halves). A build you make yourself is not an official build, even
from unchanged code. If you publish one, make your own signing keys
(`app/scripts/release-keygen.mjs`) and point its update feed at your own
releases.
