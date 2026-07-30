const {analyseProductFile} = require('../../product-import');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {statusCode: 200, headers: corsHeaders, body: ''};
  }
  if (event.httpMethod !== 'POST') {
    return {statusCode: 405, headers: corsHeaders, body: 'Method not allowed'};
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const filename = body.filename || 'catalogue';
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || '');
    if (!match) {
      return {statusCode: 400, headers: {...corsHeaders, 'Content-Type': 'application/json'}, body: JSON.stringify({error: 'Tệp tải lên không hợp lệ.'})};
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 15 * 1024 * 1024) {
      return {statusCode: 413, headers: {...corsHeaders, 'Content-Type': 'application/json'}, body: JSON.stringify({error: 'Tệp phải nhỏ hơn hoặc bằng 15 MB.'})};
    }
    const analysis = await analyseProductFile({filename, mimeType: match[1], buffer});
    return {
      statusCode: 200,
      headers: {...corsHeaders, 'Content-Type': 'application/json'},
      body: JSON.stringify({ok: true, filename, ...analysis})
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: {...corsHeaders, 'Content-Type': 'application/json'},
      body: JSON.stringify({error: error.message || 'Không thể phân tích tệp này.'})
    };
  }
};
