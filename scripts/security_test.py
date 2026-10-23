"""Authorization regressions against a temporary SQLite database only."""
import pathlib, tempfile, subprocess, os, socket, time, urllib.request, urllib.error, http.cookiejar, json
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='presenca-security-') as tmp:
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 env={**os.environ,'PORT':str(port),'IP':'127.0.0.1','DB_PATH':str(pathlib.Path(tmp)/'test.db')}
 with open(pathlib.Path(tmp)/'server.log','w+') as log:
  process=subprocess.Popen(['node','server.js'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
  try:
   origin='http://127.0.0.1:'+str(port)
   for _ in range(100):
    if process.poll() is not None:log.seek(0);raise RuntimeError(log.read())
    try:
     urllib.request.urlopen(origin,timeout=1).close();break
    except urllib.error.URLError:time.sleep(.1)
   a=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
   b=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
   def call(client,path,data=None,method=None,extra=None):
    request=urllib.request.Request(origin+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**(extra or {})},method=method)
    try:
     with client.open(request,timeout=10) as response:return response.status,json.load(response),response.headers
    except urllib.error.HTTPError as response:return response.code,json.load(response),response.headers
   assert call(a,'/api/subjects/no-session')[0]==401
   code,ua,headers=call(a,'/api/auth/register',{'email':'a@example.invalid','password':'Test-password-123','name':'A'});assert code==201
   assert 'HttpOnly' in headers['Set-Cookie'] and 'SameSite=Strict' in headers['Set-Cookie']
   code,ub,_=call(b,'/api/auth/register',{'email':'b@example.invalid','password':'Test-password-456','name':'B'});assert code==201
   assert call(a,'/api/subjects/'+ub['id'])[0]==403
   assert call(a,'/api/subjects',{'user_id':ub['id'],'name':'Not allowed','days':[]})[0]==403
   assert call(a,'/api/user/profile',{'id':ub['id'],'name':'Not allowed'},'PUT')[0]==403
   assert call(a,'/api/subjects',{'user_id':ua['id'],'name':'Math','days':['mon']},extra={'Origin':'https://attacker.invalid'})[0]==403
   code,subject,_=call(a,'/api/subjects',{'user_id':ua['id'],'name':'Math','days':['mon']});assert code in (200,201),subject
   assert call(b,'/api/subjects/'+subject['id']+'?user_id='+ub['id'],method='DELETE')[0]==403
   assert call(a,'/api/subjects/'+ua['id'])[0]==200
   assert call(a,'/api/auth/logout',{},'POST')[0]==200
   assert call(a,'/api/subjects/'+ua['id'])[0]==401
   assert call(a,'/api/auth/login',{'email':'a@example.invalid','password':'Test-password-123'})[0]==200
   for _ in range(21):last=call(b,'/api/auth/login',{'email':'b@example.invalid','password':'wrong'})
   assert last[0]==429
   print('PASS: authentication, cookie flags, cross-account read/write/delete, origin, logout, login, rate limit')
  finally:process.terminate();process.wait(timeout=10)
