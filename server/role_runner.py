"""Fixed no-tools Hermes invocation, stdin data only."""
import sys,json,os,contextlib
envelope=json.load(sys.stdin)
try:
    with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
        from dotenv import load_dotenv
        load_dotenv('/opt/data/.env',override=False)
        from hermes_cli.config import load_config
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from run_agent import AIAgent
        m=load_config()['model'];r=resolve_runtime_provider(requested=m['provider'],target_model=m['default'])
        a=AIAgent(model=m['default'],provider=r.get('provider'),base_url=r.get('base_url'),api_key=r.get('api_key'),api_mode=r.get('api_mode'),enabled_toolsets=[],max_iterations=1,max_tokens=2200,quiet_mode=True,save_trajectories=False,verbose_logging=False,skip_context_files=True,skip_memory=True,skip_background_review=True,load_soul_identity=False,checkpoints_enabled=False)
        if getattr(a,'tools',None):raise RuntimeError('Tools must be disabled')
        result=a.run_conversation(json.dumps({'untrusted_data':envelope['data']},ensure_ascii=False),system_message=envelope['prompt'])
        text=str(result.get('final_response','')).strip()
        if text.startswith('```'):text=text.split('\n',1)[1].rsplit('```',1)[0].strip()
        parsed=json.loads(text)
    print(json.dumps({'result':parsed,'model':m['default'],'provider':m['provider']},ensure_ascii=False))
except Exception as e:
    print(json.dumps({'error':type(e).__name__}));sys.exit(1)
