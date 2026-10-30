// Realistic phone tasks with ground-truth graders (read from the phone with adb, never from the model's claims).
import { execFileSync } from "node:child_process";
import { SERIAL } from "../server/config.mjs";

const sh = (cmd) => execFileSync("adb", ["-s", SERIAL, "shell", cmd], { encoding: "utf8" }).replace(/\r/g, "");

export const tasks = [
  {
    id: "dark_off",
    prompt: "Turn off dark theme on the phone.",
    grade: () => sh("cmd uimode night").includes("Night mode: no"),
  },
  {
    id: "wifi_off",
    prompt: "Turn off Wi-Fi on the phone.",
    grade: () => sh("cmd wifi status").startsWith("Wifi is disabled"),
  },
  {
    id: "airplane_from_elsewhere",
    // Starts inside another app, so the model has to find its way out first.
    setup: () => sh("am start -W -n com.google.android.deskclock/com.android.deskclock.DeskClock"),
    prompt: "Turn on airplane mode on the phone.",
    grade: () => sh("settings get global airplane_mode_on").trim() === "1",
  },
  {
    id: "brightness_min",
    prompt: "Set the phone's screen brightness to the minimum.",
    grade: () => Number(sh("settings get system screen_brightness")) <= 15,
  },
  {
    id: "contact",
    prompt: "Create a new contact on the phone named Test Contact with the phone number 555-0100.",
    grade: () => {
      // Contacts formats numbers as you type (e.g. "+1 555-010-0"), so compare digits only.
      const rows = sh("content query --uri content://com.android.contacts/data/phones --projection display_name:data1").split("\n");
      return rows.some((r) => /display_name=Test Contact\b/.test(r) && (r.match(/data1=([^,]*)/)?.[1] ?? "").replace(/\D/g, "").endsWith("5550100"));
    },
  },
  {
    id: "alarm",
    prompt: "Set an alarm on the phone for 7:30 AM.",
    grade: () => {
      const info = sh("dumpsys alarm").split("Next alarm clock information:")[1]?.split("\n\n")[0] ?? "";
      const ms = info.match(/=(\d{12,})/)?.[1] ?? info.match(/triggerTime[=:](\d{12,})/)?.[1];
      if (ms) return sh(`date -d @${Math.floor(Number(ms) / 1000)} +%H:%M`).trim() === "07:30";
      return /\b0?7:30\b/.test(info);
    },
  },
  {
    id: "chrome_heading",
    prompt: "Open https://example.com in Chrome on the phone and tell me the main heading on that page.",
    grade: (answer) => /Example Domain/i.test(answer),
  },
  {
    id: "camera_photo",
    prompt: "Take a photo with the phone's camera app.",
    // This Camera app saves to Pictures/, not DCIM/Camera, so ask the media index instead of a folder.
    grade: () => /Row: \d+ _display_name=IMG_/.test(sh("content query --uri content://media/external/images/media --projection _display_name")),
  },
];
