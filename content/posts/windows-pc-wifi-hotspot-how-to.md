---
title: How to Turn a Windows PC Into a Wi-Fi Hotspot (Windows 10 and 11)
metaTitle: "Jinsi ya Kuwasha Wi-Fi Hotspot Kwenye Windows PC"
metaDescription: Share your PC's internet with a phone or tablet using the built-in Mobile hotspot setting in Windows 11 or 10. Steps, safety and fixes.
date: 2026-11-24
author: Mclean Mbaga
category: technology-solutions
label: software
excerpt: Share your Windows PC's internet with phones and tablets using the built-in Mobile hotspot setting. Exact steps, a safe password, and what to try when it fails.
tags: [windows, wifi, software, online safety, mobile data]
---

Your laptop has internet, and your phone or a friend's tablet does not. Windows can share its connection over Wi-Fi, so the other device can get online too. You do not need extra software. The tool is already inside Windows 10 and Windows 11, and it is called Mobile hotspot.

This guide shows the steps, how to set a safe password, what it costs in data and battery, and what to try when it will not start.

## Key points

- Open **Settings**, then **Network & internet**, then **Mobile hotspot**. Microsoft gives this path for both Windows 11 and Windows 10.
- You can share a Wi-Fi, Ethernet (cable) or cellular connection.
- Set your own network name and a long password before you turn it on.
- If you share a mobile data connection, the data comes out of your plan.
- You do not need hotspot software from the internet. The built-in setting does the job.

## What a PC hotspot does

A hotspot is a small Wi-Fi network that your PC creates. Other devices join it like any Wi-Fi network, and their traffic goes out through your PC's internet connection.

Microsoft says Windows can share a Wi-Fi, Ethernet or cellular data connection with other devices. Most PCs get their internet from one of these:

- **Ethernet:** a cable from a router or office socket into your PC.
- **Wi-Fi:** your PC joins a Wi-Fi network, for example in a hostel.
- **Cellular:** a PC with a SIM card or eSIM, or a modem the PC treats as cellular.

A useful case is a hostel or office where a cable gives internet to one computer only. The PC can then share it with your phone.

One thing to check first. Some places do not allow you to share their connection. A hostel or workplace may have rules about extra devices. If you are unsure, ask.

## How to turn on Mobile hotspot in Windows 11

These steps follow Microsoft's support page. As checked on 24 November 2026, they were still the current instructions.

1. Open **Settings** and select **Network & internet**, then **Mobile hotspot**.
2. Under **Share my internet connection from**, choose the connection you want to share.
3. Under **Share over**, choose **Wi-Fi** or **Bluetooth**. Microsoft says Wi-Fi is usually faster and is the default.
4. Optional but wise: expand **Properties**, select **Edit**, and type a new network name, a password and a network band. Then select **Save**.
5. Turn on the **Mobile hotspot** switch at the top of the page.

On your phone or other device, open its Wi-Fi settings, find your network name, select it, and enter the password. Microsoft also says you can scan the QR code shown in the settings instead of typing the password.

### The quick way in Windows 11

Once you have set it up, there is a shortcut. Select the quick settings icons on the taskbar (the network, sound and battery area) and look for the **Mobile hotspot** tile. You may need to select the **Next page** arrow to see it.

Selecting the tile switches the hotspot on or off, using the settings you last saved. When it is on, the tile shows how many devices are connected. To change the password, right-click or long-press the tile and select **Go to Settings**.

## How to turn on Mobile hotspot in Windows 10

On Windows 10, Microsoft's steps are a little shorter.

1. Select **Start**, then **Settings**, then **Network & Internet**, then **Mobile hotspot**.
2. Under **Share my Internet connection from**, choose the connection to share.
3. If you want, select **Edit**, type a new network name and password, and select **Save**.
4. Turn on **Share my Internet connection with other devices**.
5. Connect the other device through its Wi-Fi settings.

A note for Windows 10 users. Microsoft says support for Windows 10 ended on 14 October 2025. Your PC still works, but Microsoft no longer gives free security fixes for it and recommends Windows 11. Keep that in mind before you let other people's phones connect to an old, unpatched PC.

## Choose a safe name and password

The default name and password work, but you can do better. Here is what to think about.

**Name.** Pick something that does not show your full name, your room number or your phone number. Anyone nearby can see the network name.

**Password.** Make it long. CISA, the US cyber-security agency, says a strong password is at least 16 characters, random and unique. It also suggests a passphrase of four to seven unrelated words. Our post on [strong passwords you can remember](/post/technology-solutions/cyber-security/strong-passwords-and-password-manager/) shows how to build one. For a hotspot, a passphrase is easy to read out to a friend and still hard to guess.

Never leave the hotspot open with no password. If you do, anyone in range can join, use your data and sit on the same small network as your devices.

**Encryption.** Microsoft's page does not tell you which encryption type the hotspot uses, so we will not guess. For a home router, CISA advises using the strongest encryption your device offers, which is WPA3 where available. On your PC hotspot, the part you control is a long password.

## Which band: 2.4 GHz or 5 GHz

In **Properties**, you may see a network band choice. Microsoft's Wi-Fi guide explains the difference:

- **2.4 GHz** works with more devices, and it goes through walls better. It is also more crowded, because microwaves, cordless phones and Bluetooth devices use it.
- **5 GHz** is usually faster but has a shorter range and does not pass through walls and other obstacles as well.

If an older phone cannot see your hotspot, try 2.4 GHz. If the phone is in the same room and you want speed, try 5 GHz. Your PC's Wi-Fi adapter decides which bands are on offer.

## How many devices can connect?

We could not find a number on Microsoft's mobile hotspot page, so we will not give one for Windows. The number depends on your PC and its Wi-Fi adapter. The tile in quick settings shows how many devices are connected right now.

For comparison, Google's Android help says a phone can share mobile data with up to 10 other devices through a Wi-Fi hotspot. That is a phone figure, not a Windows one.

Every device you add shares the same connection, so each one gets a smaller slice. Two phones and a laptop will feel fine. Six devices all watching video will not.

## What it costs: data and battery

**Data.** Microsoft says that if your device has a cellular data connection and you share it, it uses data from your plan. Everything that connected devices do, including app updates, counts. Windows treats cellular connections as metered by default, which means it holds back some background downloads. Microsoft says some Windows updates will not install automatically on a metered connection.

If you share a Wi-Fi or Ethernet connection that is not metered, the data is whatever that connection allows. A hostel with a monthly limit still counts your phone's use.

For ways to cut data use on the connected phone, see [Save Mobile Data: Settings That Make Your Bundle Last Longer](/post/technology-solutions/smartphones/save-mobile-data-on-your-phone-settings-that-help/).

**Battery.** We found no official figure for battery drain. Running a Wi-Fi network is extra work for the adapter, so on a laptop, plug in the charger if you plan to share for a long time. Switch the hotspot off when you finish.

## What about the old netsh hostednetwork method?

Some older guides tell you to type `netsh wlan set hostednetwork` commands in a command window. That was a Windows 7 era feature. Microsoft's developer pages call the related programming interfaces deprecated, and say the newer Wi-Fi Direct approach replaced them. Microsoft also says Mobile hotspot has been supported since Windows 10 version 1607.

Intel says that on Windows 10, its newer adapters no longer support hosted networks, and that they support the Windows mobile hotspot feature instead. So on a modern PC the old commands often do nothing. The Settings route above is easier and is the one Microsoft documents today.

We do not give a command-line test for adapter support. We could not find Microsoft documentation for one, and the old "Hosted network supported" line is not a reliable test now. The simplest check is to open the Mobile hotspot page. If the switch is missing or will not turn on, see the fixes below.

## If the hotspot will not start or connect

Microsoft's page on fixing Wi-Fi problems lists steps that also help here. Try them in this order.

1. **Restart the PC.** It sounds simple, and it clears many small faults.
2. **Check Airplane mode.** Go to **Settings**, **Network & Internet**, **Airplane mode**, and make sure it is off.
3. **Check that the PC itself is online.** Open a website on the PC. If the PC has no internet, it has nothing to share.
4. **Run the network troubleshooter.** In Windows 10, Microsoft points to **Network & Internet**, **Status**, then **Network troubleshooter**. On Windows 11, Microsoft points to the automated troubleshooter in the Get Help app.
5. **Try the other band.** Switch between 2.4 GHz and 5 GHz in **Properties**, save, and turn the hotspot on again.
6. **Update or reinstall the Wi-Fi driver.** Microsoft suggests getting the latest network driver from your PC maker's website first. Then you can uninstall the adapter in **Device Manager** and restart, so Windows installs a driver again. Keep the downloaded driver as a backup before you do this.
7. **Reset network commands.** Microsoft lists commands such as `netsh winsock reset`, `netsh int ip reset`, `ipconfig /release`, `ipconfig /renew` and `ipconfig /flushdns`, run in a Command Prompt opened as administrator. Run them one by one, in that order, only if the earlier steps did not help.

If a phone joins but shows "no internet", the cause is often on the PC side. Check step 3 again, then check that the right connection is chosen under **Share my internet connection from**.

## Public and open hotspots: why care?

The same safety thinking applies when you join someone else's hotspot, such as a cafe or a hotel.

The US Federal Trade Commission says that connecting through a public Wi-Fi network is usually safe, because most websites now use encryption. It tells people to look for the lock symbol or "https" in the address bar. It also warns that encryption does not protect you from a fake site built by scammers. It advises strong passwords, two-factor authentication where it is offered, and keeping your software and browser up to date.

For your own hotspot, the lesson is simple. A password keeps strangers out, and updates keep your PC safe. For a stronger account lock, read our guide to [protecting your WhatsApp account with two-step verification](/post/technology-solutions/cyber-security/protect-whatsapp-account-two-step-verification/).

## When a phone hotspot is the better choice

Your phone may be the better hotspot in these cases:

- The PC has no cellular modem, so it has no mobile data of its own.
- The PC's Wi-Fi adapter does not support the hotspot feature.
- You want the longest battery life on the laptop.

Google says on Android you swipe down, tap **Hotspot**, and can set a name and password there. Google also warns that some mobile carriers limit or charge extra for tethering, so check with your network.

Remember that a phone hotspot uses your bundle fast. Big downloads are a poor fit for it.

## Common questions

### Do I need to install hotspot software?

No. Windows 10 and Windows 11 have Mobile hotspot built in, and Microsoft's own page does not ask you to install anything. Programs from unknown websites can carry malware, so avoid them. Our guide on [installing and removing Windows programs safely](/post/technology-solutions/software/install-and-remove-programs-on-windows-safely/) explains what to watch for.

### Can I share Ethernet with a phone?

Yes. Microsoft says you can share an Ethernet connection over Wi-Fi. Choose the Ethernet connection under **Share my internet connection from**.

### Why does my hotspot not appear in the list on the phone?

Try the 2.4 GHz band, move the phone closer, and turn the hotspot off and on. Check that the PC is not in Airplane mode.

### Can I turn the hotspot on from my phone?

Microsoft says you can turn on your mobile hotspot remotely if your device has cellular. For this, both devices must have Bluetooth and be paired.

## What to do next

1. Open **Settings**, **Network & internet**, **Mobile hotspot** and look at the page. If it is there, set a new name and a long password.
2. Connect one phone first and open a website to test it.
3. Switch the hotspot off when you are done, so strangers cannot join and your battery lasts.

You do not need to be a technician to do this. It takes about five minutes the first time, and a few seconds after that.

## Sources and further reading

- [Use your Windows device as a mobile hotspot, Microsoft Support](https://support.microsoft.com/en-us/windows/use-your-windows-pc-as-a-mobile-hotspot-c89b0fad-72d5-41e8-f7ea-406ad9036b85)
- [Fix Wi-Fi connection issues in Windows, Microsoft Support](https://support.microsoft.com/en-us/windows/fix-wi-fi-connection-issues-in-windows-9424a1f7-6a3b-65a6-4d78-7f07eee84d2c)
- [Wi-Fi and your home layout, Microsoft Support](https://support.microsoft.com/windows/wi-fi-and-your-home-layout-e1ed42e7-a3c5-d1be-2abb-e8fad00ad32a)
- [Metered connections in Windows, Microsoft Support](https://support.microsoft.com/windows/metered-connections-in-windows-7b33928f-a144-b265-97b6-f2e95a87c408)
- [Wi-Fi Direct, Microsoft Learn](https://learn.microsoft.com/en-us/windows-hardware/drivers/partnerapps/wi-fi-direct)
- [Share a mobile connection by hotspot or tethering on Android, Google Android Help](https://support.google.com/android/answer/9059108)
- [Intel support article on hosted and ad hoc networks in Windows 10, Intel](https://www.intel.com/content/www/us/en/support/articles/000023257/wireless.html)
- [Use Strong Passwords, CISA](https://www.cisa.gov/secure-our-world/use-strong-passwords)
- [Are public Wi-Fi networks safe? What you need to know, Federal Trade Commission](https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know)
