import Footer from "@/components/Footer";
import PrefixRiverApp from "@/components/PrefixRiverApp";

export default function Home() {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <PrefixRiverApp />
      <Footer />
    </div>
  );
}
