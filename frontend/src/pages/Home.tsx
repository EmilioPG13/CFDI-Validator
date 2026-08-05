import SiteHeader from '../sections/SiteHeader'
import Hero from '../sections/Hero'
import Pain from '../sections/Pain'
import HowItWorks from '../sections/HowItWorks'
import Comparison from '../sections/Comparison'
import Security from '../sections/Security'
import Testimonials from '../sections/Testimonials'
import FinalCta from '../sections/FinalCta'
import SiteFooter from '../sections/SiteFooter'

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <Hero />
        <Pain />
        <HowItWorks />
        <Comparison />
        <Security />
        <Testimonials />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}
