import type { Metadata } from "next";
import Orbsie from "@/components/orbsie";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Page() {
  return <Orbsie />;
}
