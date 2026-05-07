import os
import csv
import io
import json
import re
from datetime import datetime
from flask import (Flask, render_template, request, jsonify,
                   send_file, Response)
from openpyxl import Workbook
from database import (init_db, upsert_products, get_suppliers,
                      get_available_products, mark_as_listed,
                      save_listing_history, save_upload_history,
                      get_listing_history, get_listing_detail,
                      cancel_listing, get_column_headers,
                      get_products_raw_data, get_dashboard_data,
                      save_listing_result_upload,
                      get_listing_result_uploads,
                      get_all_listing_result_uploads,
                      get_listing_result_upload,
                      update_listing_result_upload)
from parser import parse_excel, parse_table_excel

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exports')
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(EXPORT_DIR, exist_ok=True)


def _safe_upload_filename(filename):
    base = os.path.basename(filename or 'result.xlsx')
    base = base.replace('\\', '_').replace('/', '_')
    base = re.sub(r'[\x00-\x1f<>:"|?*]+', '_', base).strip(' ._')
    return base[:180] or 'result.xlsx'


def _infer_result_type(filename):
    lower = (filename or '').lower()
    if 'category' in lower or 'category_match' in lower or '카테고리' in lower:
        return '카테고리 매칭'
    if 'llm' in lower or 'gpt' in lower:
        return 'LLM 결과'
    return '후처리 결과'


def _excel_sheet_title(title):
    title = re.sub(r'[\[\]\:\*\?\/\\]', '_', title or 'result')
    return title[:31] or 'result'


def _download_filename(filename):
    base = os.path.splitext(os.path.basename(filename or 'result.xlsx'))[0]
    base = _safe_upload_filename(base)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    return f'{base}_수정본_{timestamp}.xlsx'


@app.route('/')
def index():
    return render_template('products.html', active='products')


@app.route('/history')
def history():
    return render_template('history.html', active='history')


@app.route('/results')
def results():
    return render_template('results.html', active='results')


@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html', active='dashboard')


@app.route('/api/upload', methods=['POST'])
def upload_excel():
    if 'file' not in request.files:
        return jsonify({'error': '파일이 없습니다'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': '파일명이 없습니다'}), 400

    if not file.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'error': 'Excel 파일(.xlsx)만 업로드 가능합니다'}), 400

    save_path = os.path.join(UPLOAD_DIR, 'latest_upload.xlsx')
    file.save(save_path)

    try:
        parsed = parse_excel(save_path)
        products = parsed['products']
        headers = parsed['headers']
        naver_dups = parsed['naver_duplicates']
        naver_listed = parsed.get('naver_listed_codes', [])

        new_count, updated_count, skipped_count, listed_count = upsert_products(
            products, headers, naver_dups, naver_listed
        )

        save_upload_history(
            file.filename, len(products),
            new_count, updated_count, skipped_count
        )

        return jsonify({
            'success': True,
            'total': len(products),
            'new': new_count,
            'updated': updated_count,
            'skipped': skipped_count,
            'naver_listed': listed_count,
            'naver_duplicates': len(naver_dups),
            'sheet_info': parsed['sheet_info']
        })

    except Exception as e:
        return jsonify({'error': f'파싱 오류: {str(e)}'}), 500


@app.route('/api/suppliers')
def api_suppliers():
    suppliers = get_suppliers()
    return jsonify(suppliers)


@app.route('/api/preview', methods=['POST'])
def api_preview():
    data = request.json
    suppliers = data.get('suppliers', [])
    sort_order = data.get('sort_order', 'latest')
    count = data.get('count', 5)

    if not suppliers:
        return jsonify({'error': '사업자를 선택해주세요'}), 400

    products, sku_groups = get_available_products(suppliers, sort_order, count)

    preview = []
    sku_map = {}
    for p in products:
        sg = p['sku_group']
        if sg not in sku_map:
            sku_map[sg] = {
                'sku_group': sg,
                'supplier_code': p['supplier_code'],
                'product_name': p['product_name'],
                'price': p['price'],
                'image_url': p['image_url'],
                'options': []
            }
        sku_map[sg]['options'].append({
            'product_code': p['product_code'],
            'option_code': p['option_code'],
            'product_name': p['product_name'],
            'price': p['price']
        })

    preview = list(sku_map.values())

    return jsonify({
        'preview': preview,
        'total_skus': len(sku_groups),
        'total_rows': len(products)
    })


@app.route('/api/download', methods=['POST'])
def api_download():
    data = request.json
    suppliers = data.get('suppliers', [])
    sort_order = data.get('sort_order', 'latest')
    count = data.get('count', 5)

    if not suppliers:
        return jsonify({'error': '사업자를 선택해주세요'}), 400

    products, sku_groups = get_available_products(suppliers, sort_order, count)
    if not products:
        return jsonify({'error': '다운로드할 상품이 없습니다'}), 400

    headers = get_column_headers()
    if not headers:
        return jsonify({'error': '컬럼 헤더 정보가 없습니다. 먼저 엑셀을 업로드해주세요'}), 400

    raw_data_list = get_products_raw_data(sku_groups)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    supplier_str = '_'.join(suppliers[:3])
    if len(suppliers) > 3:
        supplier_str += f'_외{len(suppliers)-3}'
    file_name = f'listing_{supplier_str}_{timestamp}.csv'

    file_path = os.path.join(EXPORT_DIR, file_name)
    with open(file_path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        for raw in raw_data_list:
            row = [raw.get(h, '') for h in headers]
            writer.writerow(row)

    batch_id = save_listing_history(
        suppliers, sort_order, count,
        len(raw_data_list), len(sku_groups),
        file_name, sku_groups
    )
    mark_as_listed(sku_groups, batch_id)

    return jsonify({
        'success': True,
        'file_name': file_name,
        'batch_id': batch_id,
        'total_skus': len(sku_groups),
        'total_rows': len(raw_data_list),
        'download_url': f'/api/download-file/{file_name}'
    })


@app.route('/api/download-file/<filename>')
def download_file(filename):
    file_path = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(file_path):
        return jsonify({'error': '파일을 찾을 수 없습니다'}), 404
    return send_file(file_path, as_attachment=True, download_name=filename)


@app.route('/api/history')
def api_history():
    history = get_listing_history()
    return jsonify(history)


@app.route('/api/history/<int:batch_id>')
def api_history_detail(batch_id):
    history, products = get_listing_detail(batch_id)
    if not history:
        return jsonify({'error': '이력을 찾을 수 없습니다'}), 404
    result_uploads = get_listing_result_uploads(batch_id)
    return jsonify({
        'history': history,
        'products': products,
        'result_uploads': result_uploads
    })


@app.route('/api/history/<int:batch_id>/result-upload', methods=['POST'])
def api_history_result_upload(batch_id):
    history, _ = get_listing_detail(batch_id)
    if not history:
        return jsonify({'error': '이력을 찾을 수 없습니다'}), 404

    files = request.files.getlist('files')
    if not files and 'file' in request.files:
        files = [request.files['file']]

    files = [file for file in files if file and file.filename]
    if not files:
        return jsonify({'error': '파일이 없습니다'}), 400

    saved_uploads = []
    result_dir = os.path.join(UPLOAD_DIR, 'result_uploads', str(batch_id))
    os.makedirs(result_dir, exist_ok=True)

    for file in files:
        if not file.filename.lower().endswith(('.xlsx', '.xlsm', '.xltx', '.xltm')):
            return jsonify({'error': '후처리 결과는 Excel 파일(.xlsx)만 업로드 가능합니다'}), 400

        original_name = os.path.basename(file.filename)
        safe_name = _safe_upload_filename(original_name)
        stored_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}_{safe_name}"
        save_path = os.path.join(result_dir, stored_name)
        file.save(save_path)

        try:
            parsed = parse_table_excel(save_path)
        except Exception as e:
            return jsonify({'error': f'결과 엑셀 파싱 오류: {str(e)}'}), 500

        upload_id = save_listing_result_upload(
            batch_id=batch_id,
            file_name=original_name,
            stored_path=save_path,
            result_type=_infer_result_type(original_name),
            sheet_name=parsed['sheet_name'],
            headers=parsed['headers'],
            rows=parsed['rows']
        )
        saved_uploads.append({
            'id': upload_id,
            'file_name': original_name,
            'result_type': _infer_result_type(original_name),
            'sheet_name': parsed['sheet_name'],
            'row_count': parsed['row_count']
        })

    return jsonify({'success': True, 'uploads': saved_uploads})


@app.route('/api/result-uploads')
def api_result_uploads():
    return jsonify(get_all_listing_result_uploads())


@app.route('/api/result-uploads/<int:upload_id>')
def api_result_upload_detail(upload_id):
    upload = get_listing_result_upload(upload_id)
    if not upload:
        return jsonify({'error': '업로드 결과를 찾을 수 없습니다'}), 404
    return jsonify(upload)


@app.route('/api/result-uploads/<int:upload_id>', methods=['PUT'])
def api_result_upload_update(upload_id):
    data = request.get_json(silent=True) or {}
    rows = data.get('rows')
    if not isinstance(rows, list):
        return jsonify({'error': '수정할 행 데이터가 없습니다'}), 400

    updated = update_listing_result_upload(upload_id, rows)
    if not updated:
        return jsonify({'error': '업로드 결과를 찾을 수 없습니다'}), 404

    return jsonify({'success': True, 'upload': updated})


@app.route('/api/result-uploads/<int:upload_id>/download')
def api_result_upload_download(upload_id):
    upload = get_listing_result_upload(upload_id)
    if not upload:
        return jsonify({'error': '업로드 결과를 찾을 수 없습니다'}), 404

    wb = Workbook()
    ws = wb.active
    ws.title = _excel_sheet_title(upload.get('sheet_name') or upload.get('result_type'))

    headers = upload.get('headers') or []
    ws.append(headers)
    for row in upload.get('rows') or []:
        ws.append([row.get(header, '') for header in headers])

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name=_download_filename(upload.get('file_name')),
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


@app.route('/api/history/<int:batch_id>/cancel', methods=['POST'])
def api_cancel_listing(batch_id):
    try:
        cancel_listing(batch_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/history/<int:batch_id>/redownload')
def api_redownload(batch_id):
    history, _ = get_listing_detail(batch_id)
    if not history:
        return jsonify({'error': '이력을 찾을 수 없습니다'}), 404

    file_name = history.get('file_name', '')
    file_path = os.path.join(EXPORT_DIR, file_name)
    if not os.path.exists(file_path):
        return jsonify({'error': '파일이 삭제되었습니다'}), 404

    return send_file(file_path, as_attachment=True, download_name=file_name)


@app.route('/api/dashboard')
def api_dashboard():
    data = get_dashboard_data()
    return jsonify(data)


if __name__ == '__main__':
    init_db()
    print("=" * 50)
    print("  상품 관리 시스템 시작")
    print("  http://localhost:5000")
    print("=" * 50)
    app.run(debug=True, port=5000)
