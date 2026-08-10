(() => {
  if (document.querySelector('.page-scroll-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'page-scroll-actions';
  actions.setAttribute('aria-label', 'Điều hướng trang');
  actions.innerHTML = '<button type="button" data-scroll-top aria-label="Về đầu trang" title="Về đầu trang">↑</button><button type="button" data-scroll-bottom aria-label="Tới cuối trang" title="Tới cuối trang">↓</button>';
  document.body.append(actions);
  const topButton = actions.querySelector('[data-scroll-top]');
  const bottomButton = actions.querySelector('[data-scroll-bottom]');
  const update = () => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const currentScroll = window.scrollY || window.pageYOffset || 0;
    const canScroll = maxScroll > 80;
    actions.classList.toggle('is-visible', canScroll);
    topButton.hidden = !canScroll || currentScroll <= 80;
    bottomButton.hidden = !canScroll || currentScroll >= maxScroll - 80;
  };
  topButton.addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'}));
  bottomButton.addEventListener('click', () => window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'smooth'}));
  window.addEventListener('scroll', update, {passive: true});
  window.addEventListener('resize', update);
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(document.body);
  update();
})();
