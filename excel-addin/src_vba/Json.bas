Option Private Module
Option Explicit

Private jsonText As String
Private jsonPos As Long

Public Function JsonParse(ByVal text As String) As Variant
    Dim value As Variant
    Dim valueIsObject As Boolean
    jsonText = text
    jsonPos = 1
    JsonSkipWhitespace
    valueIsObject = JsonNextValueIsObject()
    If valueIsObject Then
        Set value = JsonParseValue()
    Else
        value = JsonParseValue()
    End If
    JsonSkipWhitespace
    If jsonPos <= Len(jsonText) Then Err.Raise 5, "JsonParse", "Unexpected trailing JSON text."
    If valueIsObject Then
        Set JsonParse = value
    Else
        JsonParse = value
    End If
End Function

Private Function JsonParseValue() As Variant
    Dim ch As String
    JsonSkipWhitespace
    ch = JsonPeek()
    Select Case ch
        Case "{"
            Set JsonParseValue = JsonParseObject()
        Case "["
            Set JsonParseValue = JsonParseArray()
        Case """"
            JsonParseValue = JsonParseString()
        Case "t"
            JsonExpectLiteral "true"
            JsonParseValue = True
        Case "f"
            JsonExpectLiteral "false"
            JsonParseValue = False
        Case "n"
            JsonExpectLiteral "null"
            JsonParseValue = Empty
        Case Else
            JsonParseValue = JsonParseNumber()
    End Select
End Function

Private Function JsonParseObject() As Object
    Dim dict As Object
    Dim key As String
    Dim value As Variant
    Dim valueIsObject As Boolean
    
    Set dict = CreateObject("Scripting.Dictionary")
    dict.CompareMode = vbTextCompare
    JsonExpectChar "{"
    JsonSkipWhitespace
    If JsonPeek() = "}" Then
        jsonPos = jsonPos + 1
        Set JsonParseObject = dict
        Exit Function
    End If
    
    Do
        JsonSkipWhitespace
        key = JsonParseString()
        JsonSkipWhitespace
        JsonExpectChar ":"
        valueIsObject = JsonNextValueIsObject()
        If valueIsObject Then
            Set value = JsonParseValue()
        Else
            value = JsonParseValue()
        End If
        If dict.Exists(key) Then dict.Remove key
        dict.Add key, value
        JsonSkipWhitespace
        Select Case JsonPeek()
            Case ","
                jsonPos = jsonPos + 1
            Case "}"
                jsonPos = jsonPos + 1
                Exit Do
            Case Else
                Err.Raise 5, "JsonParse", "Expected ',' or '}' in object."
        End Select
    Loop
    
    Set JsonParseObject = dict
End Function

Private Function JsonParseArray() As Collection
    Dim items As Collection
    Dim value As Variant
    Dim valueIsObject As Boolean
    
    Set items = New Collection
    JsonExpectChar "["
    JsonSkipWhitespace
    If JsonPeek() = "]" Then
        jsonPos = jsonPos + 1
        Set JsonParseArray = items
        Exit Function
    End If
    
    Do
        valueIsObject = JsonNextValueIsObject()
        If valueIsObject Then
            Set value = JsonParseValue()
        Else
            value = JsonParseValue()
        End If
        items.Add value
        JsonSkipWhitespace
        Select Case JsonPeek()
            Case ","
                jsonPos = jsonPos + 1
            Case "]"
                jsonPos = jsonPos + 1
                Exit Do
            Case Else
                Err.Raise 5, "JsonParse", "Expected ',' or ']' in array."
        End Select
    Loop
    
    Set JsonParseArray = items
End Function

Private Function JsonNextValueIsObject() As Boolean
    Dim ch As String
    JsonSkipWhitespace
    ch = JsonPeek()
    JsonNextValueIsObject = (ch = "{" Or ch = "[")
End Function

Private Function JsonParseString() As String
    Dim result As String
    Dim ch As String
    Dim hexValue As String
    
    JsonExpectChar """"
    Do While jsonPos <= Len(jsonText)
        ch = Mid$(jsonText, jsonPos, 1)
        jsonPos = jsonPos + 1
        Select Case ch
            Case """"
                JsonParseString = result
                Exit Function
            Case "\"
                If jsonPos > Len(jsonText) Then Err.Raise 5, "JsonParse", "Unterminated JSON escape."
                ch = Mid$(jsonText, jsonPos, 1)
                jsonPos = jsonPos + 1
                Select Case ch
                    Case """", "\", "/"
                        result = result & ch
                    Case "b"
                        result = result & Chr$(8)
                    Case "f"
                        result = result & Chr$(12)
                    Case "n"
                        result = result & vbLf
                    Case "r"
                        result = result & vbCr
                    Case "t"
                        result = result & vbTab
                    Case "u"
                        If jsonPos + 3 > Len(jsonText) Then Err.Raise 5, "JsonParse", "Invalid JSON unicode escape."
                        hexValue = Mid$(jsonText, jsonPos, 4)
                        jsonPos = jsonPos + 4
                        result = result & ChrW$(CLng("&H" & hexValue))
                    Case Else
                        Err.Raise 5, "JsonParse", "Invalid JSON escape."
                End Select
            Case Else
                result = result & ch
        End Select
    Loop
    Err.Raise 5, "JsonParse", "Unterminated JSON string."
End Function

Private Function JsonParseNumber() As Variant
    Dim startPos As Long
    Dim token As String
    
    startPos = jsonPos
    If JsonPeek() = "-" Then jsonPos = jsonPos + 1
    Do While jsonPos <= Len(jsonText) And Mid$(jsonText, jsonPos, 1) Like "[0-9]"
        jsonPos = jsonPos + 1
    Loop
    If JsonPeek() = "." Then
        jsonPos = jsonPos + 1
        Do While jsonPos <= Len(jsonText) And Mid$(jsonText, jsonPos, 1) Like "[0-9]"
            jsonPos = jsonPos + 1
        Loop
    End If
    If LCase$(JsonPeek()) = "e" Then
        jsonPos = jsonPos + 1
        If JsonPeek() = "+" Or JsonPeek() = "-" Then jsonPos = jsonPos + 1
        Do While jsonPos <= Len(jsonText) And Mid$(jsonText, jsonPos, 1) Like "[0-9]"
            jsonPos = jsonPos + 1
        Loop
    End If
    
    token = Mid$(jsonText, startPos, jsonPos - startPos)
    If Len(token) = 0 Or token = "-" Then Err.Raise 5, "JsonParse", "Invalid JSON number."
    If InStr(1, token, ".", vbBinaryCompare) > 0 Or InStr(1, token, "e", vbTextCompare) > 0 Then
        JsonParseNumber = CDbl(token)
    Else
        JsonParseNumber = CLng(token)
    End If
End Function

Private Sub JsonExpectLiteral(ByVal literal As String)
    If Mid$(jsonText, jsonPos, Len(literal)) <> literal Then Err.Raise 5, "JsonParse", "Expected '" & literal & "'."
    jsonPos = jsonPos + Len(literal)
End Sub

Private Sub JsonExpectChar(ByVal expected As String)
    JsonSkipWhitespace
    If JsonPeek() <> expected Then Err.Raise 5, "JsonParse", "Expected '" & expected & "'."
    jsonPos = jsonPos + 1
End Sub

Private Function JsonPeek() As String
    If jsonPos > Len(jsonText) Then
        JsonPeek = vbNullString
    Else
        JsonPeek = Mid$(jsonText, jsonPos, 1)
    End If
End Function

Private Sub JsonSkipWhitespace()
    Do While jsonPos <= Len(jsonText)
        Select Case Mid$(jsonText, jsonPos, 1)
            Case " ", vbTab, vbCr, vbLf
                jsonPos = jsonPos + 1
            Case Else
                Exit Do
        End Select
    Loop
End Sub
