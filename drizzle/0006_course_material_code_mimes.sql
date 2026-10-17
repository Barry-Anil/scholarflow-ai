UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/x-ipynb+json',
  'text/x-python',
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'application/typescript',
  'text/x-typescript'
]
WHERE id = 'course-materials';
