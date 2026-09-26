const menu=document.querySelector('.menu'),nav=document.querySelector('nav');if(menu){menu.addEventListener('click',()=>nav.classList.toggle('open'));}document.querySelectorAll('nav a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('open')));

// Header shrink + scroll progress + back-to-top
const header=document.querySelector('.header'),progress=document.getElementById('scrollProgress'),topBtn=document.getElementById('topBtn');
function onScroll(){
  const y=window.scrollY||document.documentElement.scrollTop;
  header && header.classList.toggle('scrolled',y>40);
  topBtn && topBtn.classList.toggle('show',y>600);
  const h=document.documentElement.scrollHeight-window.innerHeight;
  if(progress) progress.style.width=(h>0?(y/h)*100:0)+'%';
}
window.addEventListener('scroll',onScroll,{passive:true});
onScroll();
topBtn && topBtn.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));

// Active nav link tracking
const navLinks=[...document.querySelectorAll('nav a[href^="#"]')];
const sections=navLinks.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
if('IntersectionObserver' in window && sections.length){
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        const id='#'+entry.target.id;
        navLinks.forEach(a=>a.classList.toggle('active',a.getAttribute('href')===id));
      }
    });
  },{rootMargin:'-45% 0px -50% 0px',threshold:0});
  sections.forEach(s=>io.observe(s));
}
document.querySelectorAll('.offer-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const offer=btn.dataset.offer;
    if(offer){
      const msg=encodeURIComponent(`Bonjour AfroConnect, je souhaite avoir des informations sur l'offre ${offer}.`);
      btn.href=`https://wa.me/2290196109244?text=${msg}`;
      btn.target='_blank';
      btn.rel='noopener';
    }
  });
});
