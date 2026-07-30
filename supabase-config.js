// Supabase connection for the AEON Mooncake storefront + admin.
// Loaded as a plain <script> (no bundler), so we use the UMD build from jsDelivr.
window.AEON_SUPABASE_URL = 'https://fosqegpascksaaaityui.supabase.co';
window.AEON_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvc3FlZ3Bhc2Nrc2FhYWl0eXVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzOTc3ODEsImV4cCI6MjEwMDk3Mzc4MX0.mgCPCrvHB7rlqznFGP7Ug_GsWp6PeeGQYVm6o-66Z1s';
window.AEON_UPLOADS_BUCKET = 'aeon-uploads';

window.getAeonSupabase = function () {
  if (window._aeonSupabase) return window._aeonSupabase;
  if (!window.supabase) throw new Error('Thư viện Supabase chưa tải xong. Hãy tải lại trang.');
  window._aeonSupabase = window.supabase.createClient(window.AEON_SUPABASE_URL, window.AEON_SUPABASE_ANON_KEY, {
    auth: {persistSession: false}
  });
  return window._aeonSupabase;
};

// Upload an image File to the public aeon-uploads bucket and return its public URL.
window.uploadAeonImage = async function (file) {
  if (!file) throw new Error('Hãy chọn ảnh trước khi tải lên.');
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG, WEBP hoặc GIF.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 10 MB.');

  const extension = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'png'])[1].toLowerCase();
  const base = String(file.name || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'image';
  const path = `${Date.now()}-${base}.${extension}`;
  const supabase = window.getAeonSupabase();
  const {error} = await supabase.storage.from(window.AEON_UPLOADS_BUCKET).upload(path, file, {upsert: false});
  if (error) throw new Error(error.message || 'Không thể tải ảnh lên.');
  const {data: publicUrlData} = supabase.storage.from(window.AEON_UPLOADS_BUCKET).getPublicUrl(path);
  return publicUrlData.publicUrl;
};
