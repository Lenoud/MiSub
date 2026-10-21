"""关闭 MiSub 接入 SSO 前的已知历史入口，保留当前生产版本。"""
import json
import os
import urllib.error
import urllib.request

PROJECT = 'vertflux-sub'
ACCOUNT = 'bf8566234d0f57c2451986e3cdcb01c4'
LEGACY_SHA = '3dd85716a76bfe596f6e79b5b6e4eef549955d0f'


def api(path, method='GET'):
    request = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}{path}',
        method=method,
        headers={'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN']},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Cloudflare {method} 失败，HTTP {error.code}') from None
    assert result.get('success'), 'Cloudflare 操作未成功'
    return result['result']


def commit(deployment):
    return deployment.get('deployment_trigger', {}).get('metadata', {}).get('commit_hash')


canonical = api('')['canonical_deployment']
assert commit(canonical) == os.environ['GITHUB_SHA'], '当前生产版本与本次发布不一致，停止清理'
legacy = []
page = 1
while True:
    batch = api(f'/deployments?per_page=10&page={page}')
    legacy.extend(item for item in batch if commit(item) == LEGACY_SHA)
    if len(batch) < 10:
        break
    page += 1
for item in legacy:
    current = api('')['canonical_deployment']
    assert item['id'] != current['id'] and commit(current) == os.environ['GITHUB_SHA'], '生产版本发生变化，停止清理'
    api(f'/deployments/{item["id"]}?force=true', 'DELETE')
print(json.dumps({'closed_pre_sso_deployments': len(legacy), 'current_production_preserved': True}, ensure_ascii=False))
