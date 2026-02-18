import type { Metadata } from "next";
import GuestbookClient from "./GuestbookClient";

export const metadata: Metadata = {
  title: "프라이빗 방명록",
  robots: {
    index: false,
    follow: false,
  },
};

export default function GuestbookPage() {
  return <GuestbookClient />;
}
