`timescale 1ns / 1ps

// 测试平台展示：task / function / string / $display 格式化 / if + $error 断言风格
module tb;
  import demo_pkg::*;

  logic        clk = 0;
  logic        rst_n = 0;
  cmd_t        cmd;
  logic        cmd_valid = 0;
  logic [15:0] result;
  logic        result_valid;
  logic        wide;
  logic [7:0]  count;
  int          errors = 0;
  int          checks = 0;

  sv_showcase dut (
    .clk(clk), .rst_n(rst_n), .cmd(cmd), .cmd_valid(cmd_valid),
    .result(result), .result_valid(result_valid), .wide(wide), .count(count)
  );

  always #5 clk = ~clk;

  // 枚举转字符串（Icarus 11 尚不支持 .name()，这里手写一个）
  function automatic string op_name(input op_t op);
    case (op)
      OP_NOP:  return "NOP";
      OP_ADD:  return "ADD";
      OP_MUL:  return "MUL";
      default: return "MAX";
    endcase
  endfunction

  // 参考模型
  function automatic int model(input op_t op, input int a, input int b);
    case (op)
      OP_ADD:  return a + b;
      OP_MUL:  return a * b;
      OP_MAX:  return (a > b) ? a : b;
      default: return 0;
    endcase
  endfunction

  // 发送一条命令并检查下一拍的结果（断言风格：if + $error）
  task automatic run(input op_t op, input logic [7:0] a, input logic [7:0] b);
    int exp;
    @(negedge clk);
    cmd.op = op;
    cmd.a  = a;
    cmd.b  = b;
    cmd_valid = 1;
    @(negedge clk);
    cmd_valid = 0;
    exp = model(op, a, b);
    checks++;
    if (!result_valid) begin
      $error("result_valid 未拉高");
      errors++;
    end else if (result !== exp[15:0]) begin
      $error("%s %0d, %0d：结果 %0d，期望 %0d", op_name(op), a, b, result, exp);
      errors++;
    end else if (wide !== (exp > 255)) begin
      $error("wide 标志错误：%b", wide);
      errors++;
    end else begin
      $display("  %-3s %3d, %3d -> %5d  (0x%4h)", op_name(op), a, b, result, result);
    end
  endtask

  initial begin
    string banner;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    banner = $sformatf("cmd_t 共 %0d 位", $bits(cmd_t));
    $display("SystemVerilog 特性展示：%s", banner);

    cmd = '0;
    repeat (2) @(negedge clk);
    rst_n = 1;

    run(OP_ADD, 8'd100, 8'd55);
    run(OP_MUL, 8'd12,  8'd13);
    run(OP_MAX, 8'd7,   8'd200);
    run(OP_NOP, 8'd1,   8'd2);
    run(OP_MUL, 8'd200, 8'd3);   // 600：超过 8 位，wide = 1
    for (int i = 1; i <= 4; i++) run(OP_MUL, 8'(i * 10), 8'(i + 1));

    @(negedge clk);
    if (count != 8'd9) begin
      $error("count = %0d，期望 9", count);
      errors++;
    end

    if (errors == 0) $display("PASS: %0d 条命令全部正确", checks);
    else             $display("FAIL: %0d/%0d 条命令出错", errors, checks);
    $finish;
  end
endmodule
