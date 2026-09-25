const menu=document.querySelector('.menu'),nav=document.querySelector('nav');if(menu){menu.addEventListener('click',()=>nav.classList.toggle('open'));}document.querySelectorAll('nav a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('open')));
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
