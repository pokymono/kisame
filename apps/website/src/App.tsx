import { Header } from './components/Header';
import { Hero } from './components/Hero';
// import { LogoWall } from './components/LogoWall';
import { Features } from './components/Features';
import { Footer } from './components/Footer';

function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        {/* <LogoWall /> */}
        <Features />
      </main>
      <Footer />
    </>
  );
}

export default App;
