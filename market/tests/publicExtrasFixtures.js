// SYNTHETIC TEST-ONLY records. No real product mapping or approved production asset.
export const context = { state: 'published', product_id: '11111111-1111-4111-8111-111111111111', version_id: '22222222-2222-4222-8222-222222222222' }
const review = { status: 'approved', review_id: '33333333-3333-4333-8333-333333333333', rights_basis: 'original', attribution: 'Синтетический тестовый материал' }
export const cover = { schema_version: 1, kind: 'public-cover', product_id: context.product_id, version_id: context.version_id,
  asset_id: '44444444-4444-4444-8444-444444444444', sha256: 'a'.repeat(64), mime: 'image/png', path: `/assets/public-covers/${'a'.repeat(64)}.png`, width: 800, height: 450, alt: 'Тестовая цветная карточка', review }
export const demo = { schema_version: 1, kind: 'independent-single-choice', product_id: context.product_id, version_id: context.version_id,
  demo_id: '55555555-5555-4555-8555-555555555555', revision: 1, content_sha256: 'b'.repeat(64), title: 'Учебный пример для теста',
  question: 'У какой фигуры три стороны?', hint: 'Посчитайте стороны.', choices: [
    { id: 'triangle', label: 'Треугольник', feedback: 'У треугольника три стороны.' },
    { id: 'square', label: 'Квадрат', feedback: 'У квадрата четыре стороны. Попробуйте снова.' },
  ], correct_choice_id: 'triangle', explanation: 'Название треугольника связано с тремя углами; у него также три стороны.', review }
