# OpenShore Privacy Policy

DRAFT FOR COUNSEL REVIEW. Not in effect. Prepared 2026-09-24.

Effective date: [EFFECTIVE DATE]

This policy covers the OpenShore apps (the desktop apps for Linux, macOS, and
Windows, and the iPhone and iPad app), the accounts that connect them, and the
website openshore.ai. Plain language throughout, because a privacy policy
nobody reads protects nobody.

## 1. Who we are

Open Shore, LLC is a Delaware limited liability company. We make OpenShore, a
coding agent that runs on your own models, your own computer, and your own keys.

For the personal data that reaches our servers, Open Shore, LLC is the
controller. That means we decide why and how it is used, and we answer for it.

For the data that stays on your device, we never receive it, so there is
nothing for us to control. You control it.

When you use a service straight from your device on your own account, such as
a cloud model provider on your own key, that service handles your data under
its own privacy policy. Section 5 lists them.

How to reach us:

- Email: os-code@openshorellc.com
- Mail: Open Shore, LLC, [MAILING ADDRESS]

A dedicated privacy address on openshore.ai is coming. Until it is announced,
use the email above for every privacy question and request.

Representative in the European Union: [EU REPRESENTATIVE, IF APPOINTED]
Representative in the United Kingdom: [UK REPRESENTATIVE, IF APPOINTED]

## 2. The short version

**What stays on your device.** Your chats, projects, crew and routines,
settings, session journals, and your API keys and tokens (cloud provider keys,
Git and Drive tokens, your Codemagic token). The local activity log, if you turn
it on. Any consent you give to depict a real person. None of this is ever sent
to us.

**What reaches us, and only if you create an account.** Your email, a hashed
password, and sign-in records. What you have paid for. Your team's data, if you
are on a team. A device token for push notifications, if you turn them on. Any
model review you post. A short record when the guardrail blocks something, which
never contains the text itself. If you never create an account, none of this
exists.

**What goes to other services, and only when you use them.** The cloud model
provider you connect, on your own key. The web search service, after you say
yes. Model download sites. GitHub for desktop updates. The Git host or cloud
drive you connect. Tailscale, if you link your devices with it. A speech
service, on the desktop, after you say yes. Stripe or Apple, if you pay.

**What we do not do.** No analytics. No advertising. No tracking across sites
or apps. No sale or sharing of personal information. No crash-reporting SDK. The
website sets no cookies.

## 3. What stays on your device

These live only on the device where you made them. We do not receive them, we
cannot read them, and we cannot recover them if you lose them.

- Chats and their attachments.
- Projects, instructions, and the code the agent works on.
- Your crew, routines, and the dated notes routines leave in your Vault.
- Settings.
- Session journals.
- API keys and tokens: cloud provider keys, Git host tokens, Google Drive
  tokens, and your Codemagic token.
- The local activity log. It is off until you turn it on, and it is never sent.
- Consent assertions you make to depict a real person.

Your personal Vault lives on your device, or in the iCloud Drive or Google
Drive you connect (see section 5). Only a team Vault lives on our servers (see
section 4.3).

You delete this data yourself, on your device. Section 7 says how each platform
protects it.

## 4. What reaches us, why, and for how long

Everything in this section exists only if you create an account.

The lawful bases below are for people in the European Union and the United
Kingdom. They are proposed and still with counsel.

### 4.1 Your account

**What.** Your email address, your password (stored only as a hash, never in
plain text), and records of your sign-ins. You also confirm that you are 18 or
older when you sign up. We do not collect ID.

**Why.** To create your account, sign you in, keep the account secure, and let
your phone and your computer find each other.

**Lawful basis (proposed).** Contract: we need it to give you the account you
asked for. Legitimate interests for sign-in records, to keep accounts secure.

**How long.** Until you delete your account. Our sign-in provider keeps its
own sign-in logs for [SIGN-IN LOG RETENTION].

### 4.2 What you have paid for

**What.** Your plan and its status. For team plans, your Stripe customer id and
subscription id. For the Personal plan, the original transaction id Apple gives
each purchase. The notices Apple and Stripe send us when a subscription starts,
renews, changes, or ends. We never receive your card number.

**Why.** To know what you have paid for, turn features on, restore a purchase
on a new device, and keep your plan in step with Apple or Stripe.

**Lawful basis (proposed).** Contract. Legal obligation for any billing record
the law requires us to keep.

**How long.** Until you delete your account, except any billing record the law
requires us to keep, for [BILLING RECORD RETENTION]. Stripe and Apple keep their
own records under their own policies.

### 4.3 Teams

**What.** For team accounts: the team name, the owner, each member's email and
role, and pending invites. For team projects: the project name, its
instructions, the ids of its repositories, and each member's email and access
level. For team Vault notes, on team plans: the full text of each note, who last
changed it, and when.

**Why.** To run the shared workspace your team signed up for.

**Lawful basis (proposed).** Contract, with the team owner and with each member
who accepts an invite. Legitimate interests for an invited person who has not
yet accepted, so the invite can reach them.

**How long.** Until the team removes it or deletes the team. A team Vault note
belongs to the team, so it stays with the team after the person who wrote it
leaves.

### 4.4 Push notifications

**What.** The device token Apple issues for your iPhone or iPad, and a short
log of each push we send (a session identifier and the time) so we do not send
the same one twice. The notification itself is fixed text, such as "Your session
finished." No title, code, or message from your session ever reaches us or
Apple.

**Why.** To tell you when a session finishes or needs your approval, if you
turned notifications on.

**Lawful basis (proposed).** Contract. Your device also asks for your consent
before it allows notifications, and you can withdraw it in iOS Settings at any
time.

**How long.** Until you delete your account. The send log is kept for
[PUSH SEND LOG RETENTION].

### 4.5 Community model reviews

**What.** For each review you post: the stars, your text (up to 2,000
characters), use cases, hardware, memory, speed figures, the quantization, and
the display name you choose. Your account id is attached to the review but is
never shown publicly. We also keep the time you accepted the review terms, the
reports you file on other reviews, and the reviewers you block.

**Why.** To publish your review, show fair ratings, and keep the reviews
honest and safe.

**Lawful basis (proposed).** Contract: you ask us to publish the review.
Legitimate interests for reports and blocks, to moderate and to keep people
safe.

**How long.** Until you delete the review or your account. Reports you filed
and people you blocked are deleted with your account.

A posted review is public. Anyone can read it, including people who are not
signed in, and they may copy it before you delete it.

### 4.6 Guardrail and enforcement records

When you are signed in and the guardrail blocks something, the app sends us a
short record.

**What a block record holds.** The category and tier, the time, a one-way
fingerprint of the text, whether it ran locally or in the cloud, what the screen
did, whether it was your request or the model's reply, and the names of the
rules that matched. The fingerprint is computed with a key only our server
holds, so it cannot be reversed into the text. A block record never contains
the text, and never contains a person's name.

**What it never holds.** Your prompt, the model's reply, any excerpt of either,
or a consent you gave to depict a real person. Those stay on your device.

**Enforcement records.** When we act on an account, for example by terminating
it under section 4 of the Terms, we keep a record of the action and the reason.

**Why.** To enforce the prohibited uses in the Terms, to recognize a repeat,
and to meet our legal duties, including reporting child sexual abuse material to
the National Center for Missing and Exploited Children (NCMEC).

**Lawful basis (proposed).** Legitimate interests: preventing serious abuse
and protecting children and the people depicted. Legal obligation, where the law
requires a report or requires us to keep a record.

**How long.**

- Block records: 180 days.
- Enforcement records: two years.
- Records tied to a report we submitted to NCMEC: at least one year, as federal
  law requires (18 U.S.C. 2258A(h)), and longer if law enforcement asks us to
  keep them.

Only the people we name as reviewers can see these records.

**No automated decisions with legal effect.** The guardrail blocks a request on
its own. Removing an account is decided by a person.

### 4.7 Messages you send us

**What.** Your email and whatever you choose to write.

**Why.** To answer you, and to handle rights requests, appeals, and reports.

**Lawful basis (proposed).** Legitimate interests in answering you. Legal
obligation when your message is a rights request.

**How long.** [SUPPORT EMAIL RETENTION].

### 4.8 IP addresses

OpenShore's own code never reads or stores your IP address, and the guardrail
never uses one. But any server you connect to sees the address you connect
from. Our sign-in and database provider (Supabase), the host of our website
(Cloudflare), Stripe, Apple, and GitHub see IP addresses and may log them under
their own policies.

## 5. Services that get data straight from your device

These services receive data directly from your device, and only when you use
them. They act under their own terms and privacy policies, on your own account
where you have one. They are not our processors, and we do not receive what you
send them.

| Service | When | What it receives |
| --- | --- | --- |
| Cloud model providers: Anthropic, OpenAI, Google, Moonshot (Kimi), Perplexity | When you connect one on your own key and use it | The prompts, code, and attachments in that call |
| Web search: DuckDuckGo by default, or Brave, Tavily, or Perplexity if you pick one | When the agent searches and you allow it | The search words |
| Websites the agent fetches | When the agent fetches a page and you allow it | Your IP address and the page requested |
| Hugging Face, Ollama | When you download a model | Your IP address and the model requested |
| GitHub Releases | When the desktop app checks for or downloads an update | Your IP address and the version requested |
| Google Drive | When you connect it for Repositories or Vault | The files OpenShore creates or you open with it. We ask only for the narrow drive.file scope, so OpenShore cannot see the rest of your Drive |
| iCloud Drive | When you choose it for Repositories or Vault | The files you store there, under your Apple account |
| GitHub, GitLab, Bitbucket | When you connect a repository | Your repository activity, under your account |
| Codemagic | When you connect it to build your app | Build requests and reads of build status and logs, on your own token |
| Tailscale | When you link your devices with it | What Tailscale needs to connect your own devices |
| A speech service, for example Google through the browser's speech recognition | Desktop and web only, after you turn on "Send voice to the speech service" | The audio you record |
| Stripe | When you buy or manage a team plan on the web | Your card and billing details |
| Apple | When you buy the Personal plan in the iPhone app, or install through TestFlight or the App Store | Your purchase and Apple account details |

A few details worth knowing:

- **Web search asks first.** By default the app shows you the exact search and
  the service before anything leaves, and asks once per session. The Settings
  switch "Ask before searching the web" is on by default. A routine declares on
  its setup card whether it uses the web.
- **Voice asks first on the desktop and the web.** It is off by default. The
  first time you tap the mic, a card tells you the audio goes to a speech
  service. On iPhone and iPad, speech is recognized on the device and no audio
  leaves it.
- **Git host sign-in.** When you connect GitHub, GitLab, or Bitbucket, the token
  passes through a small sign-in function on our backend so the exchange can
  finish. We do not keep it. The token is stored only on your device.
- **Apple's own sharing.** If you join the iPhone beta, TestFlight shares with
  us what it shares with any developer, such as the email we invited you at, the
  build you installed, and any feedback or crash report you choose to send. If
  you turn on Apple's "Share with App Developers" setting, Apple may send us
  crash reports and usage figures. Those are Apple's settings. We add no
  tracking of our own.

## 6. Our processors

These companies process data for us, under contract, to run the parts of
OpenShore that need a server.

| Processor | What it does for us | Where |
| --- | --- | --- |
| Supabase | Accounts, sign-in, the database, and the server functions behind sections 4.1 to 4.6 | United States (AWS us-east-1) |
| Cloudflare | Hosts the website | [CLOUDFLARE REGION] |
| Apple Push Notification service | Delivers push notifications to your device | [APNS REGION] |
| [EMAIL PROVIDER] | Sends account and renewal emails | [EMAIL PROVIDER REGION] |

Stripe and Apple handle payments as independent businesses under their own
terms. Their role is set out in section 5.

We do not sell your personal information. We do not share it for advertising.
We disclose it to others only as this policy describes, or when the law
requires it, for example a valid legal order or a report to NCMEC.

If Open Shore, LLC is ever merged or sold, your data would move to the new
owner under this policy, and we would tell you first.

## 7. Security

We keep what we hold to a minimum, because data we never receive cannot leak
from us.

**On your device.** Your keys and tokens are sealed where the platform allows.
Each platform works differently, and we say so plainly:

- **iPhone and iPad.** Sealed with AES-256-GCM. The key is held in the iOS
  Keychain.
- **Mac and Windows.** Sealed, with the key held by the operating system.
- **Linux.** Sealed only when a system keyring is present. Without one, the app
  tells you that your keys are stored unencrypted.
- **A plain web browser.** Not protected against anyone who can use that
  browser profile.

**On our servers.** Connections use HTTPS. Passwords are stored only as hashes.
The database enforces who may read each row, so a person sees only their own
data and their own team's data. The text fingerprint in a block record uses a
key held only on the server.

**If something goes wrong.** No system is perfectly secure. If a breach affects
your personal data, we will tell you and the authorities as the law requires.

## 8. Cookies and browser storage

The website sets no cookies.

After you sign in on the web, your session is kept in the browser's
localStorage so you stay signed in. It is strictly necessary for the sign-in to
work, and it is not used for anything else. Signing out clears it.

When you buy or manage a team plan, you go to Stripe's pages. Stripe sets its
own cookies there, under Stripe's cookie policy.

The apps keep your data on your device as section 3 describes. They use no
advertising identifiers.

## 9. Your rights

You can do all of this whatever country you live in. We do not charge for it.

**Delete your account.** Inside the app. This deletes your account and the
data we hold about you in section 4. Two things to know:

- If you own a team that has other members, the same flow asks you to transfer
  ownership or delete the team. Deleting a team cancels its Stripe subscription,
  with "Cancel renewal instead" offered first. The refund rule in the Refund
  and Cancellation Policy applies.
- Records under a legal hold, such as those tied to an NCMEC report, are kept
  until the hold ends, then deleted.

Deleting your account does not cancel a Personal subscription bought through
Apple. Cancel it in iOS Settings.

Your chats and other local data are yours to delete on your device. We never
had them.

**Download your data.** "Download my data" in the app gives you the data we
hold about you in JSON, a common format another service can read.

**Correct your data.** Edit it in the app where you can, such as your display
name or a review, or write to us.

**Object.** You can object to anything we do on the basis of legitimate
interests. We will stop unless we have compelling grounds, such as preventing
the abuse in section 4.6, or need it for a legal claim.

**Restrict.** You can ask us to pause using your data while we sort out a
question about it.

**Withdraw consent.** Where we rely on consent, you can withdraw it at any time,
for example by turning off notifications in iOS Settings, or by turning off
"Send voice to the speech service." Withdrawing does not undo what was lawful
before.

**Complain.** If you live in the European Union, you can complain to the data
protection authority in your country. In the United Kingdom, that is the
Information Commissioner's Office (ico.org.uk). We would like the chance to fix
it first, but you do not have to ask us before you complain.

**How to ask.** Use the app for deletion, export, and edits. For anything else,
write to os-code@openshorellc.com from your account email. We may ask you to
confirm it is you, so nobody else can get or delete your data.

**How fast.** Within one month. If a request is complex, or we get many, we may
need up to two more months. If so, we will tell you why within the first month.

## 10. California and other US states

**No sale or sharing.** We do not sell personal information, and we do not
share it for cross-context behavioral advertising. We have not done so in the
last 12 months.

**Do Not Track.** We do not track you across sites or apps, so a Do Not Track
signal or a Global Privacy Control signal changes nothing. No third party
collects personal information about your activity across sites through
OpenShore.

**California law (CalOPPA).** This policy lists what we collect (section 4),
who receives it (sections 5 and 6), how you review and correct it (section 9),
how we tell you about changes (section 14), and its effective date (top).

**CCPA and CPRA.** OpenShore does not currently meet the thresholds that make
the California Consumer Privacy Act apply. If it ever does, California
residents will have the right to know what we collect and why, to delete, to
correct, to opt out of sale or sharing (which we do not do), to limit use of
sensitive personal information, and not to be treated differently for using any
of these rights. You can already do most of this through section 9.

**Other states.** The same applies to the privacy laws of other US states.
Where one applies to us, you can use section 9, and you can appeal a refusal by
writing to us.

## 11. Children

OpenShore is for people 18 and older. You confirm your age when you create an
account. We do not collect ID. The apps and the site are not directed to
children.

If we learn that an account belongs to someone under 18, we delete it. If you
know of one, write to us.

## 12. International transfers

Open Shore, LLC is based in the United States. Our backend runs in the United
States (AWS us-east-1, Northern Virginia). If you use OpenShore from the
European Union or the United Kingdom, the data in section 4 may be transferred
to the United States or other countries.

We protect those transfers with [TRANSFER MECHANISM]. You can ask us for a copy
of the safeguards.

Services you use straight from your device (section 5) make their own transfer
arrangements under their own policies.

## 13. Data retention at a glance

| Data | Kept for |
| --- | --- |
| Account, entitlements, push device token | Until you delete your account |
| Sign-in logs at Supabase | [SIGN-IN LOG RETENTION] |
| Billing records the law requires | [BILLING RECORD RETENTION] |
| Team data | Until the team removes it or deletes the team |
| Reviews | Until you delete the review or your account |
| Reports you filed, people you blocked | Until you delete your account |
| Push send log | [PUSH SEND LOG RETENTION] |
| Guardrail block records | 180 days |
| Enforcement records | Two years |
| Records tied to an NCMEC report | At least one year, longer if law enforcement asks |
| Messages to us | [SUPPORT EMAIL RETENTION] |
| Backups | Deleted data leaves backups within [BACKUP RETENTION] |

## 14. Changes to this policy

We will update this policy when the product changes. The date at the top
always shows the latest version.

If a change is material, for example a new kind of data reaching us or a new
use for it, we will tell you in the app, and by email if you have an account,
at least [NOTICE PERIOD] before it takes effect. We will never start using data
we already hold in a materially different way without telling you first, and
asking where the law requires consent.

## 15. Contact

Questions, requests, and complaints about privacy:

- Email: os-code@openshorellc.com
- Mail: Open Shore, LLC, [MAILING ADDRESS]

## Open items for counsel

1. Confirm the lawful bases in section 4 (all marked proposed), especially the
   basis for invited team members who have not accepted and for guardrail
   records.
2. Decide on Art. 27 representatives in the EU and the UK, and fill in section
   1. The rulings hold EU and UK team billing until this is decided.
3. Controller or processor for team data: is OpenShore a processor for a
   team's projects and Vault notes, and does a team plan need a data processing
   agreement?
4. Fill in the transfer mechanism (section 12) and the Supabase, Cloudflare,
   APNs, and email provider regions (section 6). Confirm the email provider.
5. Fill in retention for sign-in logs, billing records, the push send log,
   support email, and backups.
6. Confirm the NCMEC hold wording against 18 U.S.C. 2258A(h), including the
   law enforcement extension.
7. Confirm that "Download my data" covers everything a GDPR access request
   covers, including guardrail and enforcement records, and whether any may be
   withheld.
8. Confirm that account deletion removes a member's email from team and team
   project member lists (the database keeps the row with the account link
   cleared), and whether team Vault notes a person wrote should stay with the
   team.
9. Confirm Cloudflare sets no cookies on the site (for example a bot
   management cookie), since the policy says the website sets none.
10. Confirm the TestFlight and "Share with App Developers" wording in section
    5.
11. The address ruling mentions "list email". If OpenShore runs a mailing list
    or beta waitlist, add it here (data, provider, consent, unsubscribe).
12. Confirm the notice period for material changes (section 14).
13. Confirm the CCPA threshold statement and whether any other US state law
    already applies.
14. Confirm breach notification wording against GDPR, UK GDPR, and US state
    breach laws.
