# Privacy Policy - InstaSaver Pro

**Last Updated:** October 2026  
**Developer:** DL Mídia / Daniel Júnior  
**Contact:** contato@dlmidia.com.br

## Overview
InstaSaver Pro is an open-source Google Chrome extension designed to help content creators and marketers download their own media and publicly viewable media from Instagram (Reels, Posts, Stories, and Highlights) directly to their local computers.

## Data Collection and Usage
1. **No Personal Data Collection:** InstaSaver Pro does **not** collect, store, sell, or transmit any personal identifiable information (PII), browsing history, account credentials, cookies, or user tracking data.
2. **Direct Local Downloads:** All media downloads occur entirely between Instagram's public content delivery networks (CDNs) and the user's local browser via Chrome's official `chrome.downloads` API. No media passes through any third-party proxy or remote backend server.
3. **No Third-Party Analytics or Ads:** The extension contains zero third-party tracking scripts, zero advertising networks, and zero telemetry SDKs.
4. **Permissions Justification:**
   - `downloads`: Required solely to save media files (MP4 and JPG) directly to the user's computer.
   - `activeTab` & `scripting`: Required solely to inspect media elements (`<video>` and `<img>`) on the currently open Instagram tab.
   - `webRequest`: Required exclusively as a non-blocking observer to detect media URLs loaded by Instagram's web player.
   - `storage`: Required only to store local user preferences (such as showing/hiding in-page buttons or customized filename prefixes) locally on the device.

## Trademark Disclaimer
Instagram is a registered trademark of Meta Platforms, Inc. InstaSaver Pro is an independent project and is not affiliated with, endorsed by, sponsored by, or associated with Instagram or Meta Platforms, Inc.

## Changes to this Policy
Any updates to this policy will be reflected in this repository.

For questions or inquiries, please contact: `contato@dlmidia.com.br`.
