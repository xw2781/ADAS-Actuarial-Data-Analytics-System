Attribute VB_Name = "ListBoxMouseWheel"
Option Private Module
Option Explicit

Private Const WH_MOUSE_LL As Long = 14
Private Const WM_MOUSEWHEEL As Long = &H20A
Private Const WHEEL_DELTA As Long = 120
Private Const WHEEL_LINES As Long = 3

Private Type POINTAPI
    X As Long
    Y As Long
End Type

Private Type MSLLHOOKSTRUCT
    pt As POINTAPI
    mouseData As Long
    flags As Long
    time As Long
#If VBA7 Then
    dwExtraInfo As LongPtr
#Else
    dwExtraInfo As Long
#End If
End Type

#If VBA7 Then
    Private Declare PtrSafe Function SetWindowsHookEx Lib "user32" Alias "SetWindowsHookExA" ( _
        ByVal idHook As Long, _
        ByVal lpfn As LongPtr, _
        ByVal hmod As LongPtr, _
        ByVal dwThreadId As Long) As LongPtr

    Private Declare PtrSafe Function UnhookWindowsHookEx Lib "user32" ( _
        ByVal hHook As LongPtr) As Long

    Private Declare PtrSafe Function CallNextHookEx Lib "user32" ( _
        ByVal hHook As LongPtr, _
        ByVal nCode As Long, _
        ByVal wParam As LongPtr, _
        ByVal lParam As LongPtr) As LongPtr

    Private Declare PtrSafe Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" ( _
        ByRef Destination As Any, _
        ByVal Source As LongPtr, _
        ByVal Length As LongPtr)

    Private mMouseHook As LongPtr
#Else
    Private Declare Function SetWindowsHookEx Lib "user32" Alias "SetWindowsHookExA" ( _
        ByVal idHook As Long, _
        ByVal lpfn As Long, _
        ByVal hmod As Long, _
        ByVal dwThreadId As Long) As Long

    Private Declare Function UnhookWindowsHookEx Lib "user32" ( _
        ByVal hHook As Long) As Long

    Private Declare Function CallNextHookEx Lib "user32" ( _
        ByVal hHook As Long, _
        ByVal nCode As Long, _
        ByVal wParam As Long, _
        ByVal lParam As Long) As Long

    Private Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" ( _
        ByRef Destination As Any, _
        ByVal Source As Long, _
        ByVal Length As Long)

    Private mMouseHook As Long
#End If

Private mWheelListBox As Object

Public Sub EnableMouseWheelForListBox(ByVal targetListBox As Object)
    Set mWheelListBox = targetListBox

    If mMouseHook <> 0 Then Exit Sub

    mMouseHook = SetWindowsHookEx(WH_MOUSE_LL, AddressOf MouseWheelProc, 0, 0)
End Sub

Public Sub DisableMouseWheelForListBox()
    On Error Resume Next

    If mMouseHook <> 0 Then
        UnhookWindowsHookEx mMouseHook
        mMouseHook = 0
    End If
    Set mWheelListBox = Nothing

    On Error GoTo 0
End Sub

#If VBA7 Then
Public Function MouseWheelProc(ByVal nCode As Long, ByVal wParam As LongPtr, ByVal lParam As LongPtr) As LongPtr
#Else
Public Function MouseWheelProc(ByVal nCode As Long, ByVal wParam As Long, ByVal lParam As Long) As Long
#End If
    On Error GoTo PassThrough

    If nCode >= 0 And wParam = WM_MOUSEWHEEL Then
        If ScrollWheelListBox(lParam) Then
            MouseWheelProc = 1
            Exit Function
        End If
    End If

PassThrough:
    MouseWheelProc = CallNextHookEx(mMouseHook, nCode, wParam, lParam)
End Function

#If VBA7 Then
Private Function ScrollWheelListBox(ByVal lParam As LongPtr) As Boolean
#Else
Private Function ScrollWheelListBox(ByVal lParam As Long) As Boolean
#End If
    Dim info As MSLLHOOKSTRUCT
    Dim delta As Long
    Dim lineCount As Long
    Dim currentTop As Long
    Dim nextTop As Long

    If mWheelListBox Is Nothing Then Exit Function
    If mWheelListBox.ListCount <= 0 Then Exit Function

    CopyMemory info, lParam, LenB(info)
    delta = WheelDeltaFromMouseData(info.mouseData)
    If delta = 0 Then Exit Function

    lineCount = WHEEL_LINES
    If Abs(delta) >= WHEEL_DELTA Then
        lineCount = WHEEL_LINES * (Abs(delta) \ WHEEL_DELTA)
    End If

    currentTop = CLng(mWheelListBox.TopIndex)
    If delta > 0 Then
        nextTop = currentTop - lineCount
    Else
        nextTop = currentTop + lineCount
    End If

    If nextTop < 0 Then nextTop = 0
    If nextTop > mWheelListBox.ListCount - 1 Then nextTop = mWheelListBox.ListCount - 1

    mWheelListBox.TopIndex = nextTop
    ScrollWheelListBox = True
End Function

Private Function WheelDeltaFromMouseData(ByVal mouseData As Long) As Long
    WheelDeltaFromMouseData = mouseData \ 65536
End Function
