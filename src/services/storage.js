const cloudinary = require('cloudinary').v2;

function configured() {
  return Boolean(process.env.CLOUDINARY_URL);
}

function uploadBuffer(file, folder) {
  if (!configured()) throw new Error('File storage is not configured.');

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto', use_filename: true, unique_filename: true },
      (error, result) => error ? reject(error) : resolve(result)
    );
    stream.end(file.buffer);
  });
}

async function deleteAsset(publicId, resourceType = 'image') {
  if (!configured() || !publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = { configured, uploadBuffer, deleteAsset };
