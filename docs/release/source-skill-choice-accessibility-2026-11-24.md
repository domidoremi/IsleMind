# 技能层级与叠加方式单选状态维护

技能编辑中的层级和叠加方式增加中英日分组名称，复用现有WorkspaceTabs与WorkspaceChoice的radio语义、选中底色和下划线。每组保持唯一选中；Web支持方向键、Home／End、循环、焦点跟随及组间Tab。保存期间两组禁用，名称、指令、手动优先级与其他草稿值保持。

旧实现两侧各两项行为测试失败、运行错误零；修复后工作区四组117项、独立main四组114项通过，两侧类型、14项架构及模块边界通过。main核对2314实际HEAD输入、47实际虚拟类型读取、诊断0；不包含共享选择控件的既有未完成修改。五份源码及本记录为最小提交。

Web实际factory／source map与11份源码对应。三语×五主题×明暗×三尺寸共90组合，320×844、844×390、1280×900；唯一选中／停点、方向键和Home／End、Tab／ShiftTab、草稿保持、90次实际UI保存与独立读回通过。14图已目视，仅授目标两组可见文字、选中标记和焦点轮廓资格。原用户浏览器空间未操作，隔离无持久context已销毁，外部请求、页面错误及音频尝试零。另在减少动态模式完成同样90组合及90次保存，13份当前源码绑定与实际Moti选中标记零时长／无缩放参数核对通过；该模式14图尚未目视，不新增视觉资格。

第76份真机同步核对2183输入、4161模块和39绑定，仅技能页面与三语资源四个运行工厂变化；实际Inspector源码与独立Metro一致，设备cache差异仅为已记录origin页脚。同步热更新期间编辑器实例变为11356，受支持重载后为182，原文字／附件／选区／焦点保持。禁止将实例变化表述为全程同一实例。

1250完成三语×五主题明暗30组、181次真实Android操作。5个选项每组唯一checked，原生checkable／focusable／enabled与三语标签准确，触控区域至少44dp，全部16草稿值在选择和主题切换后保持。默认40／adaptive／override和手动7／base／append两次保存重开、删除取消和确认通过；UI删除1、恢复删除0、模型请求0。14张真机图已目视，只授既有1080×2400尺寸的两组控件可见区域。显示准备使用公开内存store及语言API，路由进入使用公开router.push，不计为设置页UI或导航入口验收。未启用TalkBack。

1254在场景清理后独立通过SQLite及AsyncStorage回读全部原六raw键、字面字符串、数量和数据库结构；53表3256行、全部原资料及六组草稿恢复、编辑器值、完整原父路由、设备设置、前台与70请求一致。空技能键仅在原缺席、现值[]、本轮保存所有权成立时移除；Inspector、reverse和pending清空。PID9956保持。469受保护输入及共享五输入按本补丁精确保留。

1236初次候选准备在main缺少WorkspaceSurface锚点时中止、产品零写入；提前执行的旧源码两失败及缺manifest失败保持，1239独立通过。玻璃主题Web窄屏下方字段间距疑点经三语五主题明暗30组测量未复现重叠，玻璃输入底到下标签9px；不据此改产品或授整页资格。此前1206空技能键和1208恢复、旧定位等失败保持。

源码版本1.1.26／151、既有APK1.1.2／127。31生产路由与55原型、完整主题／语言／尺寸、大字体、输入、静默无障碍、恢复及性能仍未闭环。fullAcceptance、nativeVerified、visualAcceptance和广义loadedRuntimeVerified保持false。全部进程隐藏窗口后台执行，无APK构建／导出／安装、设备音频／TalkBack／音量操作；提交推送与发布各自核对当前工作流，禁止触发Actions。

证据：test-evidence/implementation/skill-choice-accessibility-20261123/choice-qualified-1255.json、web-choice-flow-1240.json、native-choice-host-1250.json、native-stage76-after-choice-original-baseline-1254.json。
